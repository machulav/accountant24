import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The pi sidecars' IPC boundary. agentBridge talks to the children only through
// this module, so it's the single seam we fake. `h` holds the fake's captured
// listeners + a record of what the bridge sent (with its target session), so
// tests can drive the stream (emit responses/stream events) and observe
// outgoing commands.
const h = vi.hoisted(() => ({
  eventListeners: new Set<(e: unknown) => void>(),
  terminatedListeners: new Set<(info: unknown) => void>(),
  errorListeners: new Set<(info: unknown) => void>(),
  sent: [] as { sessionPath: string; command: unknown }[],
}));

vi.mock("../../rpc/api", () => ({
  agentApi: {
    send: vi.fn(async (sessionPath: string, command: object) => {
      h.sent.push({ sessionPath, command });
    }),
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
    onError: vi.fn(async (cb: (info: unknown) => void) => {
      h.errorListeners.add(cb);
      return () => {
        h.errorListeners.delete(cb);
      };
    }),
  },
}));

const A = "/ws/sessions/a.jsonl";
const B = "/ws/sessions/b.jsonl";

// The bridge is a module singleton, so each test re-imports it fresh after a
// module reset to avoid leaking wire/pending state.
async function loadBridge() {
  const mod = await import("../agentBridge");
  return mod.agentBridge;
}

/** Let the bridge's async wire → send microtasks drain. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const emit = (e: unknown) => {
  for (const cb of [...h.eventListeners]) cb(e);
};
/** The correlation id request() attached to the sent command of the given type
 *  (pi echoes it back on the response — the fake mirrors that contract). */
const sentId = (type: string): string | undefined =>
  (h.sent.find((c) => (c.command as { type?: string }).type === type)?.command as { id?: string } | undefined)?.id;
/** Emit the response to the previously-sent command of the given type. */
const respondTo = (type: string, over: Record<string, unknown>) =>
  emit({ type: "response", id: sentId(type), command: type, ...over });
const emitTerminated = (info: unknown) => {
  for (const cb of [...h.terminatedListeners]) cb(info);
};
const emitError = (sessionPath: string, message: string) => {
  for (const cb of [...h.errorListeners]) cb({ sessionPath, message });
};
const commands = () => h.sent.map((c) => c.command);

beforeEach(() => {
  h.eventListeners.clear();
  h.terminatedListeners.clear();
  h.errorListeners.clear();
  h.sent.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("agentBridge", () => {
  describe("send()", () => {
    it("should forward the command with its target session", async () => {
      const bridge = await loadBridge();
      await bridge.send(A, { type: "ping" });
      expect(h.sent).toEqual([{ sessionPath: A, command: { type: "ping" } }]);
    });

    it("should route each command to its own session", async () => {
      const bridge = await loadBridge();
      await bridge.send(A, { n: 1 });
      await bridge.send(B, { n: 2 });
      expect(h.sent).toEqual([
        { sessionPath: A, command: { n: 1 } },
        { sessionPath: B, command: { n: 2 } },
      ]);
    });

    it("should attach the stream listeners exactly once across many sends", async () => {
      const bridge = await loadBridge();
      await bridge.send(A, {});
      await bridge.send(B, {});
      await flush();
      expect(h.eventListeners.size).toBe(1);
      expect(h.terminatedListeners.size).toBe(1);
      expect(h.errorListeners.size).toBe(1);
    });
  });

  describe("request()", () => {
    it("should resolve with the response data when a response with the matching id arrives", async () => {
      const bridge = await loadBridge();
      const p = bridge.request(A, { type: "get_state" }, "get_state");
      await flush();
      expect(h.sent[0].sessionPath).toBe(A);
      expect(commands()).toContainEqual(expect.objectContaining({ type: "get_state" }));

      respondTo("get_state", { success: true, data: { model: "m1" } });
      await expect(p).resolves.toEqual({ model: "m1" });
    });

    it("should attach a unique correlation id when sending each command", async () => {
      const bridge = await loadBridge();
      const p1 = bridge.request(A, { type: "get_state" }, "get_state");
      const p2 = bridge.request(A, { type: "get_messages" }, "get_messages");
      [p1, p2].map((p) => p.catch(() => {}));
      await flush();

      const ids = commands().map((c) => (c as { id?: string }).id);
      expect(ids[0]).toBeTruthy();
      expect(ids[1]).toBeTruthy();
      expect(ids[0]).not.toBe(ids[1]);
    });

    it("should reject with the response error when success is false", async () => {
      const bridge = await loadBridge();
      const p = bridge.request(A, { type: "do_x" }, "do_x");
      await flush();
      respondTo("do_x", { success: false, error: "boom" });
      await expect(p).rejects.toThrow("boom");
    });

    it("should reject with a default message when a failed response carries no error", async () => {
      const bridge = await loadBridge();
      const p = bridge.request(A, { type: "do_x" }, "do_x");
      await flush();
      respondTo("do_x", { success: false });
      await expect(p).rejects.toThrow("do_x failed");
    });

    it("should stay pending when a response carries a different id", async () => {
      const bridge = await loadBridge();
      const p = bridge.request(A, { type: "get_state" }, "get_state");
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

      // Same command name, foreign id — must not settle this request.
      emit({ type: "response", id: "someone-else", command: "get_state", success: true, data: 1 });
      await flush();
      expect(state).toBe("pending");

      respondTo("get_state", { success: true, data: 2 });
      await expect(p).resolves.toBe(2);
    });

    it("should resolve each request with its own data when two same-command requests overlap", async () => {
      const bridge = await loadBridge();
      const p1 = bridge.request(A, { type: "get_state" }, "get_state");
      const p2 = bridge.request(A, { type: "get_state" }, "get_state");
      await flush();

      const [c1, c2] = commands().filter((c) => (c as { type?: string }).type === "get_state") as { id?: string }[];
      // Answer the second request FIRST — out-of-order delivery must not
      // cross-wire the results.
      emit({ type: "response", id: c2.id, command: "get_state", success: true, data: "B" });
      emit({ type: "response", id: c1.id, command: "get_state", success: true, data: "A" });

      await expect(p1).resolves.toBe("A");
      await expect(p2).resolves.toBe("B");
    });

    it("should resolve each request with its own data when two SESSIONS' same-command requests overlap", async () => {
      const bridge = await loadBridge();
      const pA = bridge.request(A, { type: "get_state" }, "get_state");
      const pB = bridge.request(B, { type: "get_state" }, "get_state");
      await flush();

      const idA = (h.sent.find((c) => c.sessionPath === A)?.command as { id?: string }).id;
      const idB = (h.sent.find((c) => c.sessionPath === B)?.command as { id?: string }).id;
      // Children's responses interleave on the one multiplexed stream — the
      // per-request UUID keeps them apart, B's answer arriving first.
      emit({ type: "response", id: idB, command: "get_state", success: true, data: "for B" });
      emit({ type: "response", id: idA, command: "get_state", success: true, data: "for A" });

      await expect(pA).resolves.toBe("for A");
      await expect(pB).resolves.toBe("for B");
    });

    it("should resolve only once when two matching responses arrive", async () => {
      const bridge = await loadBridge();
      const p = bridge.request(A, { type: "get_state" }, "get_state");
      await flush();
      respondTo("get_state", { success: true, data: 1 });
      respondTo("get_state", { success: true, data: 2 });
      await expect(p).resolves.toBe(1);
    });

    it("should not add IPC listeners for in-flight requests (responses ride the one wired stream)", async () => {
      const bridge = await loadBridge();
      await bridge.send(A, {});
      await flush();
      const base = h.eventListeners.size; // the single process-lifetime wire listener

      const p1 = bridge.request(A, { type: "get_state" }, "get_state");
      const p2 = bridge.request(B, { type: "get_messages" }, "get_messages");
      await flush();
      expect(h.eventListeners.size).toBe(base);

      respondTo("get_state", { success: true, data: 0 });
      respondTo("get_messages", { success: true, data: 0 });
      await Promise.all([p1, p2]);
    });
  });

  describe("request() failure paths", () => {
    it("should reject an in-flight request when its session's child crashes", async () => {
      const bridge = await loadBridge();
      const p = bridge.request(A, {}, "get_state");
      await flush();

      emitTerminated({ sessionPath: A, code: 1, signal: null, stderr: "kaboom" });
      await expect(p).rejects.toThrow(/agent stopped/i);
    });

    it("should reject every in-flight request of the crashed session", async () => {
      const bridge = await loadBridge();
      const p1 = bridge.request(A, {}, "cmd1");
      const p2 = bridge.request(A, {}, "cmd2");
      await flush();

      emitTerminated({ sessionPath: A, code: null, signal: "SIGKILL", stderr: "" });
      await expect(p1).rejects.toThrow();
      await expect(p2).rejects.toThrow();
    });

    it("should keep another session's in-flight request pending when one session crashes", async () => {
      const bridge = await loadBridge();
      const pA = bridge.request(A, { type: "get_state" }, "get_state");
      const pB = bridge.request(B, { type: "get_messages" }, "get_messages");
      await flush();

      let stateB = "pending";
      pB.then(
        () => {
          stateB = "resolved";
        },
        () => {
          stateB = "rejected";
        },
      );

      emitTerminated({ sessionPath: A, code: 1, signal: null, stderr: "" });
      await expect(pA).rejects.toThrow();
      await flush();
      expect(stateB).toBe("pending");

      // B's child is untouched and still answers.
      respondTo("get_messages", { success: true, data: { messages: [] } });
      await expect(pB).resolves.toEqual({ messages: [] });
    });

    it("should reject an in-flight request when its session has a spawn error", async () => {
      const bridge = await loadBridge();
      const p = bridge.request(A, {}, "get_state");
      await flush();

      emitError(A, "spawn ENOENT");
      await expect(p).rejects.toThrow("spawn ENOENT");
    });

    it("should keep an already-resolved request's outcome when a later crash occurs", async () => {
      const bridge = await loadBridge();
      const p = bridge.request(A, { type: "get_state" }, "get_state");
      await flush();
      respondTo("get_state", { success: true, data: 42 });
      await expect(p).resolves.toBe(42);

      // A crash after the request already settled must be a no-op for it.
      emitTerminated({ sessionPath: A, code: 1, signal: null, stderr: "" });
      await expect(p).resolves.toBe(42);
    });

    it("should reject the request when no response arrives within 30s", async () => {
      vi.useFakeTimers();
      const bridge = await loadBridge();
      const p = bridge.request(A, {}, "slow");
      p.catch(() => {});

      await vi.advanceTimersByTimeAsync(30_000);
      await expect(p).rejects.toThrow("slow timed out");
    });

    it("should stay pending at 29999ms and reject at 30000ms when no response arrives", async () => {
      vi.useFakeTimers();
      const bridge = await loadBridge();
      const p = bridge.request(A, {}, "slow");
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
      const p = bridge.request(A, { type: "x" }, "x");
      await vi.advanceTimersByTimeAsync(0);

      respondTo("x", { success: true, data: 7 });
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
      await flush();

      emit({ type: "turn_start", sessionPath: A });
      expect(seen).toEqual([{ type: "turn_start", sessionPath: A }]);
    });

    it("should deliver every session's events to subscribers, tagged with their session", async () => {
      const bridge = await loadBridge();
      const seen: { sessionPath?: string }[] = [];
      bridge.addEventListener((e) => seen.push(e));
      await flush();

      emit({ type: "agent_start", sessionPath: A });
      emit({ type: "agent_start", sessionPath: B });
      expect(seen.map((e) => e.sessionPath)).toEqual([A, B]);
    });

    it("should not forward response events to stream subscribers", async () => {
      const bridge = await loadBridge();
      const seen: unknown[] = [];
      bridge.addEventListener((e) => seen.push(e));
      await flush();

      emit({ type: "response", command: "x", success: true, data: 1, sessionPath: A });
      expect(seen).toHaveLength(0);
    });

    it("should stop delivering events when the subscriber unsubscribes", async () => {
      const bridge = await loadBridge();
      const seen: unknown[] = [];
      const off = bridge.addEventListener((e) => seen.push(e));
      await flush();

      off();
      emit({ type: "turn_start", sessionPath: A });
      expect(seen).toHaveLength(0);
    });
  });

  describe("extension_ui_request auto-confirm", () => {
    it("should auto-confirm to the originating session and not forward to subscribers", async () => {
      const bridge = await loadBridge();
      const seen: unknown[] = [];
      bridge.addEventListener((e) => seen.push(e));
      await flush();

      emit({ type: "extension_ui_request", id: "q1", method: "confirm", sessionPath: B });
      expect(h.sent).toContainEqual({
        sessionPath: B,
        command: { type: "extension_ui_response", id: "q1", confirmed: true },
      });
      expect(seen).toHaveLength(0);
    });

    it("should answer with an empty value when an input request arrives", async () => {
      const bridge = await loadBridge();
      bridge.addEventListener(() => {});
      await flush();

      emit({ type: "extension_ui_request", id: "q2", method: "input", sessionPath: A });
      expect(h.sent).toContainEqual({
        sessionPath: A,
        command: { type: "extension_ui_response", id: "q2", confirmed: true, value: "" },
      });
    });
  });

  describe("process errors (addErrorListener)", () => {
    it("should report a restart hint and stderr tail when a child is signal-terminated", async () => {
      const bridge = await loadBridge();
      const msgs: { sessionPath: string; message: string }[] = [];
      bridge.addErrorListener((sessionPath, message) => msgs.push({ sessionPath, message }));
      await flush();

      emitTerminated({ sessionPath: A, code: null, signal: "SIGKILL", stderr: "line1\nline2" });
      expect(msgs).toHaveLength(1);
      expect(msgs[0].sessionPath).toBe(A);
      expect(msgs[0].message).toContain("(SIGKILL)");
      expect(msgs[0].message).toContain("Send a message to restart it.");
      expect(msgs[0].message).toContain("line2");
    });

    it("should report the exit code when a child exits without a signal", async () => {
      const bridge = await loadBridge();
      const msgs: string[] = [];
      bridge.addErrorListener((_s, m) => msgs.push(m));
      await flush();

      emitTerminated({ sessionPath: A, code: 1, signal: null, stderr: "" });
      expect(msgs[0]).toContain("(exit 1)");
    });

    it("should report a bare stop message when there is neither signal nor code", async () => {
      const bridge = await loadBridge();
      const msgs: string[] = [];
      bridge.addErrorListener((_s, m) => msgs.push(m));
      await flush();

      emitTerminated({ sessionPath: A, code: null, signal: null, stderr: "" });
      expect(msgs[0]).toBe("The agent stopped. Send a message to restart it.");
    });

    it("should truncate the stderr tail to the last 8 lines when stderr is longer", async () => {
      const bridge = await loadBridge();
      const msgs: string[] = [];
      bridge.addErrorListener((_s, m) => msgs.push(m));
      await flush();

      const stderr = Array.from({ length: 12 }, (_, i) => `L${i + 1}`).join("\n"); // L1..L12
      emitTerminated({ sessionPath: A, code: 1, signal: null, stderr });
      expect(msgs[0]).toContain("L5"); // 12 - 8 + 1
      expect(msgs[0]).not.toContain("L4");
    });

    it("should pass the session and message through verbatim when a spawn error occurs", async () => {
      const bridge = await loadBridge();
      const msgs: { sessionPath: string; message: string }[] = [];
      bridge.addErrorListener((sessionPath, message) => msgs.push({ sessionPath, message }));
      await flush();

      emitError(B, "spawn failed");
      expect(msgs).toEqual([{ sessionPath: B, message: "spawn failed" }]);
    });

    it("should stop notifying an error listener when it unsubscribes", async () => {
      const bridge = await loadBridge();
      const msgs: string[] = [];
      const off = bridge.addErrorListener((_s, m) => msgs.push(m));
      await flush();

      off();
      emitError(A, "later crash");
      expect(msgs).toHaveLength(0);
    });
  });
});
