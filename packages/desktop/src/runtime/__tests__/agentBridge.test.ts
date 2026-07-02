import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The pi sidecar's IPC boundary. agentBridge talks to the child only through
// this module, so it's the single seam we fake. `h` holds the fake's captured
// listeners + a record of what the bridge sent, so tests can drive the stream
// (emit responses/stream events) and observe outgoing commands.
const h = vi.hoisted(() => ({
  eventListeners: new Set<(e: unknown) => void>(),
  terminatedListeners: new Set<(info: unknown) => void>(),
  errorListeners: new Set<(m: string) => void>(),
  sent: [] as unknown[],
  startCount: { n: 0 },
}));

vi.mock("../../rpc/api", () => ({
  agentApi: {
    start: vi.fn(async () => {
      h.startCount.n++;
    }),
    send: vi.fn(async (command: object) => {
      h.sent.push(command);
    }),
    stop: vi.fn(async () => {}),
    onEvent: vi.fn(async (cb: (e: unknown) => void) => {
      h.eventListeners.add(cb);
      return () => {
        h.eventListeners.delete(cb);
      };
    }),
    onTerminated: vi.fn(async (cb: (info: unknown) => void) => {
      h.terminatedListeners.add(cb);
      return () => {
        h.terminatedListeners.delete(cb);
      };
    }),
    onError: vi.fn(async (cb: (m: string) => void) => {
      h.errorListeners.add(cb);
      return () => {
        h.errorListeners.delete(cb);
      };
    }),
  },
}));

// The bridge is a module singleton, so each test re-imports it fresh after a
// module reset to avoid leaking `wired`/`startPromise`/pending state.
async function loadBridge() {
  const mod = await import("../agentBridge");
  return mod.agentBridge;
}

/** Let the bridge's async ensureStarted → wire → send microtasks drain. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const emit = (e: unknown) => {
  for (const cb of [...h.eventListeners]) cb(e);
};
const emitTerminated = (info: unknown) => {
  for (const cb of [...h.terminatedListeners]) cb(info);
};
const emitError = (m: string) => {
  for (const cb of [...h.errorListeners]) cb(m);
};

beforeEach(() => {
  h.eventListeners.clear();
  h.terminatedListeners.clear();
  h.errorListeners.clear();
  h.sent.length = 0;
  h.startCount.n = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("agentBridge", () => {
  describe("sidecar lifecycle", () => {
    it("should start the sidecar and forward the command when send() is called", async () => {
      const bridge = await loadBridge();
      await bridge.send({ type: "ping" });
      expect(h.startCount.n).toBe(1);
      expect(h.sent).toContainEqual({ type: "ping" });
    });

    it("should start the sidecar only once when send() is called repeatedly", async () => {
      const bridge = await loadBridge();
      await bridge.send({ n: 1 });
      await bridge.send({ n: 2 });
      expect(h.startCount.n).toBe(1);
    });

    it("should respawn the sidecar when send() is called after a crash", async () => {
      const bridge = await loadBridge();
      await bridge.send({});
      await flush();
      expect(h.startCount.n).toBe(1);

      emitTerminated({ code: 1, signal: null, stderr: "" });

      await bridge.send({});
      await flush();
      expect(h.startCount.n).toBe(2);
    });
  });

  describe("request()", () => {
    it("should resolve with the response data when a matching response arrives", async () => {
      const bridge = await loadBridge();
      const p = bridge.request({ type: "get_state" }, "get_state");
      await flush();
      expect(h.sent).toContainEqual({ type: "get_state" });

      emit({ type: "response", command: "get_state", success: true, data: { model: "m1" } });
      await expect(p).resolves.toEqual({ model: "m1" });
    });

    it("should reject with the response error when success is false", async () => {
      const bridge = await loadBridge();
      const p = bridge.request({}, "do_x");
      await flush();
      emit({ type: "response", command: "do_x", success: false, error: "boom" });
      await expect(p).rejects.toThrow("boom");
    });

    it("should reject with a default message when a failed response carries no error", async () => {
      const bridge = await loadBridge();
      const p = bridge.request({}, "do_x");
      await flush();
      emit({ type: "response", command: "do_x", success: false });
      await expect(p).rejects.toThrow("do_x failed");
    });

    it("should stay pending when a response for a different command arrives", async () => {
      const bridge = await loadBridge();
      const p = bridge.request({}, "get_state");
      await flush();

      let state = "pending";
      p.then(
        () => {
          state = "resolved";
        },
        () => {
          state = "rejected";
        },
      );

      emit({ type: "response", command: "other", success: true, data: 1 });
      await flush();
      expect(state).toBe("pending");

      emit({ type: "response", command: "get_state", success: true, data: 2 });
      await expect(p).resolves.toBe(2);
    });

    it("should resolve only once when two matching responses arrive", async () => {
      const bridge = await loadBridge();
      const p = bridge.request({}, "get_state");
      await flush();
      emit({ type: "response", command: "get_state", success: true, data: 1 });
      emit({ type: "response", command: "get_state", success: true, data: 2 });
      await expect(p).resolves.toBe(1);
    });

    it("should remove its per-request event listener when the request settles", async () => {
      const bridge = await loadBridge();
      await bridge.send({});
      await flush();
      const base = h.eventListeners.size; // the single process-lifetime wire listener

      const p = bridge.request({}, "get_state");
      await flush();
      expect(h.eventListeners.size).toBe(base + 1);

      emit({ type: "response", command: "get_state", success: true, data: 0 });
      await p;
      expect(h.eventListeners.size).toBe(base);
    });
  });

  describe("request() failure paths", () => {
    it("should reject an in-flight request when the sidecar crashes", async () => {
      const bridge = await loadBridge();
      const p = bridge.request({}, "get_state");
      await flush();

      emitTerminated({ code: 1, signal: null, stderr: "kaboom" });
      await expect(p).rejects.toThrow(/agent stopped/i);
    });

    it("should reject every in-flight request when the sidecar crashes", async () => {
      const bridge = await loadBridge();
      const p1 = bridge.request({}, "cmd1");
      const p2 = bridge.request({}, "cmd2");
      await flush();

      emitTerminated({ code: null, signal: "SIGKILL", stderr: "" });
      await expect(p1).rejects.toThrow();
      await expect(p2).rejects.toThrow();
    });

    it("should reject an in-flight request when a spawn error occurs", async () => {
      const bridge = await loadBridge();
      const p = bridge.request({}, "get_state");
      await flush();

      emitError("spawn ENOENT");
      await expect(p).rejects.toThrow("spawn ENOENT");
    });

    it("should remove the per-request listener when a crash rejects it", async () => {
      const bridge = await loadBridge();
      const p = bridge.request({}, "get_state");
      await flush();
      const withRequest = h.eventListeners.size;

      emitTerminated({ code: 1, signal: null, stderr: "" });
      await expect(p).rejects.toThrow();
      expect(h.eventListeners.size).toBe(withRequest - 1);
    });

    it("should keep an already-resolved request's outcome when a later crash occurs", async () => {
      const bridge = await loadBridge();
      const p = bridge.request({}, "get_state");
      await flush();
      emit({ type: "response", command: "get_state", success: true, data: 42 });
      await expect(p).resolves.toBe(42);

      // A crash after the request already settled must be a no-op for it.
      emitTerminated({ code: 1, signal: null, stderr: "" });
      await expect(p).resolves.toBe(42);
    });

    it("should reject the request when no response arrives within 30s", async () => {
      vi.useFakeTimers();
      const bridge = await loadBridge();
      const p = bridge.request({}, "slow");
      p.catch(() => {});

      await vi.advanceTimersByTimeAsync(30_000);
      await expect(p).rejects.toThrow("slow timed out");
    });

    it("should stay pending at 29999ms and reject at 30000ms when no response arrives", async () => {
      vi.useFakeTimers();
      const bridge = await loadBridge();
      const p = bridge.request({}, "slow");
      let state = "pending";
      p.then(
        () => {
          state = "resolved";
        },
        () => {
          state = "rejected";
        },
      );

      await vi.advanceTimersByTimeAsync(29_999);
      expect(state).toBe("pending");

      await vi.advanceTimersByTimeAsync(1);
      expect(state).toBe("rejected");
    });

    it("should not reject after 30s when a response already arrived", async () => {
      vi.useFakeTimers();
      const bridge = await loadBridge();
      const p = bridge.request({}, "x");
      await vi.advanceTimersByTimeAsync(0);

      emit({ type: "response", command: "x", success: true, data: 7 });
      await expect(p).resolves.toBe(7);

      // Advancing well past the timeout must not turn the resolved request into a rejection.
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(p).resolves.toBe(7);
    });
  });

  describe("live event stream (addEventListener)", () => {
    it("should forward a stream event to subscribers when a non-response event arrives", async () => {
      const bridge = await loadBridge();
      const seen: unknown[] = [];
      bridge.addEventListener((e) => seen.push(e));
      await bridge.send({});
      await flush();

      emit({ type: "turn_start" });
      expect(seen).toEqual([{ type: "turn_start" }]);
    });

    it("should not forward response events to stream subscribers", async () => {
      const bridge = await loadBridge();
      const seen: unknown[] = [];
      bridge.addEventListener((e) => seen.push(e));
      await bridge.send({});
      await flush();

      emit({ type: "response", command: "x", success: true, data: 1 });
      expect(seen).toHaveLength(0);
    });

    it("should stop delivering events when the subscriber unsubscribes", async () => {
      const bridge = await loadBridge();
      const seen: unknown[] = [];
      const off = bridge.addEventListener((e) => seen.push(e));
      await bridge.send({});
      await flush();

      off();
      emit({ type: "turn_start" });
      expect(seen).toHaveLength(0);
    });
  });

  describe("extension_ui_request auto-confirm", () => {
    it("should auto-confirm and not forward to subscribers when a confirm request arrives", async () => {
      const bridge = await loadBridge();
      const seen: unknown[] = [];
      bridge.addEventListener((e) => seen.push(e));
      await bridge.send({});
      await flush();

      emit({ type: "extension_ui_request", id: "q1", method: "confirm" });
      expect(h.sent).toContainEqual({ type: "extension_ui_response", id: "q1", confirmed: true });
      expect(seen).toHaveLength(0);
    });

    it("should answer with an empty value when an input request arrives", async () => {
      const bridge = await loadBridge();
      await bridge.send({});
      await flush();

      emit({ type: "extension_ui_request", id: "q2", method: "input" });
      expect(h.sent).toContainEqual({ type: "extension_ui_response", id: "q2", confirmed: true, value: "" });
    });
  });

  describe("process errors (addErrorListener)", () => {
    it("should report a restart hint and stderr tail when the sidecar is signal-terminated", async () => {
      const bridge = await loadBridge();
      const msgs: string[] = [];
      bridge.addErrorListener((m) => msgs.push(m));
      await bridge.send({});
      await flush();

      emitTerminated({ code: null, signal: "SIGKILL", stderr: "line1\nline2" });
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toContain("(SIGKILL)");
      expect(msgs[0]).toContain("Send a message to restart it.");
      expect(msgs[0]).toContain("line2");
    });

    it("should report the exit code when the sidecar exits without a signal", async () => {
      const bridge = await loadBridge();
      const msgs: string[] = [];
      bridge.addErrorListener((m) => msgs.push(m));
      await bridge.send({});
      await flush();

      emitTerminated({ code: 1, signal: null, stderr: "" });
      expect(msgs[0]).toContain("(exit 1)");
    });

    it("should report a bare stop message when there is neither signal nor code", async () => {
      const bridge = await loadBridge();
      const msgs: string[] = [];
      bridge.addErrorListener((m) => msgs.push(m));
      await bridge.send({});
      await flush();

      emitTerminated({ code: null, signal: null, stderr: "" });
      expect(msgs[0]).toBe("The agent stopped. Send a message to restart it.");
    });

    it("should truncate the stderr tail to the last 8 lines when stderr is longer", async () => {
      const bridge = await loadBridge();
      const msgs: string[] = [];
      bridge.addErrorListener((m) => msgs.push(m));
      await bridge.send({});
      await flush();

      const stderr = Array.from({ length: 12 }, (_, i) => `L${i + 1}`).join("\n"); // L1..L12
      emitTerminated({ code: 1, signal: null, stderr });
      expect(msgs[0]).toContain("L5"); // 12 - 8 + 1
      expect(msgs[0]).not.toContain("L4");
    });

    it("should pass the message through verbatim when a spawn error occurs", async () => {
      const bridge = await loadBridge();
      const msgs: string[] = [];
      bridge.addErrorListener((m) => msgs.push(m));
      await bridge.send({});
      await flush();

      emitError("spawn failed");
      expect(msgs).toContain("spawn failed");
    });

    it("should stop notifying an error listener when it unsubscribes", async () => {
      const bridge = await loadBridge();
      const msgs: string[] = [];
      const off = bridge.addErrorListener((m) => msgs.push(m));
      await bridge.send({});
      await flush();

      off();
      emitError("later crash");
      expect(msgs).toHaveLength(0);
    });
  });
});
