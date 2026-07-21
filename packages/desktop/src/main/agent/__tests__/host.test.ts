import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AgentHostNotice } from "../../../shared/agentHost";
import { AgentHost, type HostRuntime, type HostSession, type UiBridge } from "../host/host";

// AgentHost is the utilityProcess core: per-session runtimes, RPC-shaped
// command dispatch, event serialization, and the idle reaper/LRU cap. The pi
// SDK is the faked boundary (an injected RuntimeFactory); the dispatch,
// queueing, and lifecycle logic runs for real. Response shapes are specified
// against pi's dist/modes/rpc/rpc-mode.js.

/** A fake pi session whose behavior each test scripts. */
function makeSession() {
  const listeners: Array<(event: object) => void> = [];
  const state = {
    prompt: vi.fn(async (_text: string, opts?: { preflightResult?: (ok: boolean) => void }) => {
      opts?.preflightResult?.(true);
    }),
    abort: vi.fn(async () => {}),
    setModel: vi.fn(async (_model: unknown) => {}),
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn(),
    subscribe: vi.fn((fn: (event: object) => void) => {
      listeners.push(fn);
      return () => {
        listeners.splice(listeners.indexOf(fn), 1);
      };
    }),
    modelRegistry: { getAvailable: vi.fn(async () => [{ provider: "anthropic", id: "claude" }]) },
    model: { provider: "anthropic", id: "claude" },
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all",
    followUpMode: "all",
    sessionFile: "/ws/sessions/a.jsonl",
    sessionId: "sid-1",
    sessionName: "My chat",
    autoCompactionEnabled: true,
    messages: [] as unknown[],
    pendingMessageCount: 0,
  };
  return {
    session: state as unknown as HostSession & typeof state,
    emit: (event: object) => {
      for (const fn of [...listeners]) fn(event);
    },
    listenerCount: () => listeners.length,
  };
}
type FakeSession = ReturnType<typeof makeSession>;

const A = "/ws/sessions/a.jsonl";
const B = "/ws/sessions/b.jsonl";

let posts: AgentHostNotice[];
let fakes: Map<string, FakeSession>;
let disposes: Map<string, ReturnType<typeof vi.fn>>;
let uis: Map<string, UiBridge>;
let factory: Mock<(sessionPath: string, ui: UiBridge) => Promise<HostRuntime>>;
let host: AgentHost;

/** Build a host whose factory hands out one scripted fake session per path. */
function makeHost(opts?: { failFor?: Set<string> }) {
  posts = [];
  fakes = new Map();
  disposes = new Map();
  uis = new Map();
  factory = vi.fn(async (sessionPath: string, ui: UiBridge): Promise<HostRuntime> => {
    if (opts?.failFor?.has(sessionPath)) throw new Error(`no model for ${sessionPath}`);
    uis.set(sessionPath, ui);
    const fake = makeSession();
    fakes.set(sessionPath, fake);
    const dispose = vi.fn(async () => {});
    disposes.set(sessionPath, dispose);
    return { session: fake.session, dispose };
  });
  host = new AgentHost({ createRuntime: factory, post: (n) => posts.push(n) });
  return host;
}

const command = (sessionPath: string, cmd: Record<string, unknown>) =>
  host.handleMessage({ kind: "command", sessionPath, command: cmd });

/** Parsed event lines posted for the given session. */
const lines = (sessionPath: string): Record<string, unknown>[] =>
  posts
    .filter(
      (p): p is Extract<AgentHostNotice, { kind: "event" }> => p.kind === "event" && p.sessionPath === sessionPath,
    )
    .map((p) => JSON.parse(p.line));

const responses = (sessionPath: string) => lines(sessionPath).filter((l) => l.type === "response");

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  makeHost();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("session creation", () => {
  it("should create the runtime lazily on the first command", async () => {
    command(A, { type: "get_state", id: "1" });
    await flush();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0][0]).toBe(A);
  });

  it("should create the runtime once for back-to-back commands", async () => {
    command(A, { type: "get_state", id: "1" });
    command(A, { type: "get_messages", id: "2" });
    await flush();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(responses(A)).toHaveLength(2);
  });

  it("should create one runtime per session", async () => {
    command(A, { type: "get_state", id: "1" });
    command(B, { type: "get_state", id: "2" });
    await flush();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("should post a session_error and clear the slot when creation fails", async () => {
    makeHost({ failFor: new Set([A]) });
    command(A, { type: "get_state", id: "1" });
    await flush();

    expect(posts).toContainEqual({ kind: "session_error", sessionPath: A, message: `no model for ${A}` });
    // The queued command still gets its own error response (so a renderer
    // request fails fast instead of timing out).
    expect(responses(A)).toEqual([
      { id: "1", type: "response", command: "get_state", success: false, error: `no model for ${A}` },
    ]);
  });

  it("should retry creation on the next command after a failure", async () => {
    const failFor = new Set([A]);
    makeHost({ failFor });
    command(A, { type: "get_state", id: "1" });
    await flush();

    failFor.delete(A);
    command(A, { type: "get_state", id: "2" });
    await flush();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(responses(A).at(-1)).toMatchObject({ id: "2", success: true });
  });
});

describe("command ordering", () => {
  it("should run a session's commands strictly in arrival order", async () => {
    command(A, { type: "get_state", id: "0" });
    await flush();
    let releaseSetModel!: () => void;
    fakes.get(A)?.session.setModel.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          releaseSetModel = r;
        }),
    );

    command(A, { type: "set_model", id: "1", provider: "anthropic", modelId: "claude" });
    command(A, { type: "get_state", id: "2" });
    await flush();
    // get_state must wait for the slow set_model ahead of it in the queue.
    expect(responses(A).map((r) => r.id)).toEqual(["0"]);

    releaseSetModel();
    await flush();
    expect(responses(A).map((r) => r.id)).toEqual(["0", "1", "2"]);
  });

  it("should not let one session's slow command block another session", async () => {
    command(A, { type: "get_state", id: "0" });
    await flush();
    fakes.get(A)?.session.setModel.mockImplementationOnce(() => new Promise<never>(() => {}));

    command(A, { type: "set_model", id: "1", provider: "anthropic", modelId: "claude" });
    command(B, { type: "get_state", id: "2" });
    await flush();
    expect(responses(B).map((r) => r.id)).toEqual(["2"]);
  });
});

describe("commands", () => {
  beforeEach(async () => {
    command(A, { type: "get_state", id: "warmup" });
    await flush();
    posts.length = 0;
  });

  it("should respond success to prompt only after preflight succeeds", async () => {
    command(A, { type: "prompt", id: "p1", message: "hi", images: [{ data: "x" }], streamingBehavior: "buffer" });
    await flush();

    const session = fakes.get(A)?.session;
    expect(session?.prompt).toHaveBeenCalledWith("hi", {
      images: [{ data: "x" }],
      streamingBehavior: "buffer",
      source: "rpc",
      preflightResult: expect.any(Function),
    });
    expect(responses(A)).toEqual([{ id: "p1", type: "response", command: "prompt", success: true }]);
  });

  it("should respond an error when prompt rejects before preflight", async () => {
    fakes.get(A)?.session.prompt.mockImplementationOnce(async () => {
      throw new Error("no model configured");
    });
    command(A, { type: "prompt", id: "p1", message: "hi" });
    await flush();
    expect(responses(A)).toEqual([
      { id: "p1", type: "response", command: "prompt", success: false, error: "no model configured" },
    ]);
  });

  it("should not double-respond when prompt rejects after preflight succeeded", async () => {
    fakes.get(A)?.session.prompt.mockImplementationOnce(async (_text, opts) => {
      opts?.preflightResult?.(true);
      throw new Error("stream died");
    });
    command(A, { type: "prompt", id: "p1", message: "hi" });
    await flush();
    expect(responses(A)).toEqual([{ id: "p1", type: "response", command: "prompt", success: true }]);
  });

  it("should abort the session on abort", async () => {
    command(A, { type: "abort", id: "1" });
    await flush();
    expect(fakes.get(A)?.session.abort).toHaveBeenCalled();
    expect(responses(A)).toEqual([{ id: "1", type: "response", command: "abort", success: true }]);
  });

  it("should resolve set_model against the registry and apply it", async () => {
    command(A, { type: "set_model", id: "1", provider: "anthropic", modelId: "claude" });
    await flush();
    expect(fakes.get(A)?.session.setModel).toHaveBeenCalledWith({ provider: "anthropic", id: "claude" });
    expect(responses(A)).toEqual([
      { id: "1", type: "response", command: "set_model", success: true, data: { provider: "anthropic", id: "claude" } },
    ]);
  });

  it("should respond an error for an unknown model", async () => {
    command(A, { type: "set_model", id: "1", provider: "openai", modelId: "nope" });
    await flush();
    expect(fakes.get(A)?.session.setModel).not.toHaveBeenCalled();
    expect(responses(A)).toEqual([
      { id: "1", type: "response", command: "set_model", success: false, error: "Model not found: openai/nope" },
    ]);
  });

  it("should respond an error when a session method throws", async () => {
    fakes.get(A)?.session.setModel.mockRejectedValueOnce(new Error("registry exploded"));
    command(A, { type: "set_model", id: "1", provider: "anthropic", modelId: "claude" });
    await flush();
    expect(responses(A)).toEqual([
      { id: "1", type: "response", command: "set_model", success: false, error: "registry exploded" },
    ]);
  });

  it("should set the thinking level", async () => {
    command(A, { type: "set_thinking_level", id: "1", level: "high" });
    await flush();
    expect(fakes.get(A)?.session.setThinkingLevel).toHaveBeenCalledWith("high");
    expect(responses(A)).toEqual([{ id: "1", type: "response", command: "set_thinking_level", success: true }]);
  });

  it("should trim and set the session name", async () => {
    command(A, { type: "set_session_name", id: "1", name: "  Groceries  " });
    await flush();
    expect(fakes.get(A)?.session.setSessionName).toHaveBeenCalledWith("Groceries");
    expect(responses(A)).toEqual([{ id: "1", type: "response", command: "set_session_name", success: true }]);
  });

  it("should reject an empty session name", async () => {
    command(A, { type: "set_session_name", id: "1", name: "   " });
    await flush();
    expect(fakes.get(A)?.session.setSessionName).not.toHaveBeenCalled();
    expect(responses(A)).toEqual([
      { id: "1", type: "response", command: "set_session_name", success: false, error: "Session name cannot be empty" },
    ]);
  });

  it("should return the full rpc-mode state shape on get_state", async () => {
    const fake = fakes.get(A);
    if (fake) fake.session.messages.push({ role: "user" }, { role: "assistant" });
    command(A, { type: "get_state", id: "1" });
    await flush();

    expect(responses(A)).toEqual([
      {
        id: "1",
        type: "response",
        command: "get_state",
        success: true,
        data: {
          model: { provider: "anthropic", id: "claude" },
          thinkingLevel: "medium",
          isStreaming: false,
          isCompacting: false,
          steeringMode: "all",
          followUpMode: "all",
          sessionFile: "/ws/sessions/a.jsonl",
          sessionId: "sid-1",
          sessionName: "My chat",
          autoCompactionEnabled: true,
          messageCount: 2,
          pendingMessageCount: 0,
        },
      },
    ]);
  });

  it("should return the messages on get_messages", async () => {
    fakes.get(A)?.session.messages.push({ role: "user", content: "hi" });
    command(A, { type: "get_messages", id: "1" });
    await flush();
    expect(responses(A)).toEqual([
      {
        id: "1",
        type: "response",
        command: "get_messages",
        success: true,
        data: { messages: [{ role: "user", content: "hi" }] },
      },
    ]);
  });

  it("should respond an error for an unknown command type", async () => {
    command(A, { type: "steer", id: "1", message: "x" });
    await flush();
    expect(responses(A)).toEqual([
      { id: "1", type: "response", command: "steer", success: false, error: "Unknown command: steer" },
    ]);
  });
});

describe("event forwarding", () => {
  it("should serialize each session event as a line tagged with its session", async () => {
    command(A, { type: "get_state", id: "1" });
    command(B, { type: "get_state", id: "2" });
    await flush();
    posts.length = 0;

    fakes.get(A)?.emit({ type: "agent_start" });
    fakes.get(B)?.emit({ type: "message_update", message: { role: "assistant" } });

    expect(lines(A)).toEqual([{ type: "agent_start" }]);
    expect(lines(B)).toEqual([{ type: "message_update", message: { role: "assistant" } }]);
  });
});

describe("extension UI", () => {
  it("should resolve a pending dialog on extension_ui_response", async () => {
    command(A, { type: "get_state", id: "1" });
    await flush();
    const ui = uis.get(A);
    if (!ui) throw new Error("no ui bridge");

    let resolved: Record<string, unknown> | undefined;
    ui.pending.set("d1", {
      resolve: (r) => {
        resolved = r;
      },
      reject: () => {},
    });
    command(A, { type: "extension_ui_response", id: "d1", confirmed: true });
    expect(resolved).toEqual({ type: "extension_ui_response", id: "d1", confirmed: true });
    expect(ui.pending.has("d1")).toBe(false);
  });

  it("should ignore an extension_ui_response with an unknown id", async () => {
    command(A, { type: "get_state", id: "1" });
    await flush();
    expect(() => command(A, { type: "extension_ui_response", id: "nope", confirmed: true })).not.toThrow();
  });

  it("should forward ui.emit events as lines for the session", async () => {
    command(A, { type: "get_state", id: "1" });
    await flush();
    posts.length = 0;
    uis.get(A)?.emit({ type: "extension_ui_request", id: "d1", method: "confirm", title: "Sure?" });
    expect(lines(A)).toEqual([{ type: "extension_ui_request", id: "d1", method: "confirm", title: "Sure?" }]);
  });
});

describe("dispose_session", () => {
  it("should abort, dispose, and ack with the requestId", async () => {
    command(A, { type: "get_state", id: "1" });
    await flush();
    posts.length = 0;

    host.handleMessage({ kind: "dispose_session", sessionPath: A, requestId: "r1" });
    await flush();

    expect(fakes.get(A)?.session.abort).toHaveBeenCalled();
    expect(disposes.get(A)).toHaveBeenCalled();
    expect(posts).toContainEqual({ kind: "session_closed", sessionPath: A, reason: "disposed", requestId: "r1" });
  });

  it("should ack a dispose of a session that was never started", async () => {
    host.handleMessage({ kind: "dispose_session", sessionPath: A, requestId: "r1" });
    await flush();
    expect(posts).toContainEqual({ kind: "session_closed", sessionPath: A, reason: "disposed", requestId: "r1" });
  });

  it("should unsubscribe so a disposed session's late events are dropped", async () => {
    command(A, { type: "get_state", id: "1" });
    await flush();
    host.handleMessage({ kind: "dispose_session", sessionPath: A, requestId: "r1" });
    await flush();
    posts.length = 0;

    fakes.get(A)?.emit({ type: "agent_end" });
    expect(lines(A)).toEqual([]);
  });

  it("should recreate the session on a command after a dispose", async () => {
    command(A, { type: "get_state", id: "1" });
    await flush();
    host.handleMessage({ kind: "dispose_session", sessionPath: A, requestId: "r1" });
    await flush();

    command(A, { type: "get_state", id: "2" });
    await flush();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(responses(A).at(-1)).toMatchObject({ id: "2", success: true });
  });

  it("should still ack when the runtime dispose throws", async () => {
    command(A, { type: "get_state", id: "1" });
    await flush();
    disposes.get(A)?.mockRejectedValueOnce(new Error("teardown failed"));

    host.handleMessage({ kind: "dispose_session", sessionPath: A, requestId: "r1" });
    await flush();
    expect(posts).toContainEqual({ kind: "session_closed", sessionPath: A, reason: "disposed", requestId: "r1" });
  });
});

describe("disposeAll", () => {
  it("should dispose every session", async () => {
    command(A, { type: "get_state", id: "1" });
    command(B, { type: "get_state", id: "2" });
    await flush();

    await host.disposeAll();
    expect(disposes.get(A)).toHaveBeenCalled();
    expect(disposes.get(B)).toHaveBeenCalled();
  });
});

describe("idle reaper", () => {
  it("should dispose an idle session after the TTL and announce it as reaped", async () => {
    vi.useFakeTimers();
    host.startReaper();
    command(A, { type: "get_state", id: "1" });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(disposes.get(A)).toHaveBeenCalled();
    expect(posts).toContainEqual({ kind: "session_closed", sessionPath: A, reason: "reaped" });
  });

  it("should never reap a streaming session, however long it runs", async () => {
    vi.useFakeTimers();
    host.startReaper();
    command(A, { type: "prompt", id: "1", message: "go" });
    await vi.advanceTimersByTimeAsync(0);
    const fake = fakes.get(A);
    if (fake) (fake.session as { isStreaming: boolean }).isStreaming = true;

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(disposes.get(A)).not.toHaveBeenCalled();
  });

  it("should reap a session once its run ended and the TTL passed", async () => {
    vi.useFakeTimers();
    host.startReaper();
    command(A, { type: "prompt", id: "1", message: "go" });
    await vi.advanceTimersByTimeAsync(0);
    const fake = fakes.get(A);
    if (fake) (fake.session as { isStreaming: boolean }).isStreaming = true;
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    if (fake) (fake.session as { isStreaming: boolean }).isStreaming = false;
    fake?.emit({ type: "agent_end" }); // fresh activity as the run ends

    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(disposes.get(A)).toHaveBeenCalled();
  });

  it("should keep a session alive while commands keep arriving within the TTL", async () => {
    vi.useFakeTimers();
    host.startReaper();
    command(A, { type: "get_state", id: "0" });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      command(A, { type: "get_state", id: `${i + 1}` });
    }
    expect(disposes.get(A)).not.toHaveBeenCalled();
  });

  it("should treat streamed events as activity", async () => {
    vi.useFakeTimers();
    host.startReaper();
    command(A, { type: "get_state", id: "1" });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    fakes.get(A)?.emit({ type: "message_update" });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // 10 minutes since the last event — still inside the TTL.
    expect(disposes.get(A)).not.toHaveBeenCalled();
  });
});

describe("session cap", () => {
  async function fillSessions(count: number) {
    for (let i = 0; i < count; i += 1) {
      command(`/ws/sessions/s${i}.jsonl`, { type: "get_state", id: `${i}` });
      await vi.advanceTimersByTimeAsync(1000);
    }
  }

  it("should evict the least-recently-active idle session at the cap", async () => {
    vi.useFakeTimers();
    await fillSessions(8);
    expect(factory).toHaveBeenCalledTimes(8);

    command("/ws/sessions/s8.jsonl", { type: "get_state", id: "8" });
    await vi.advanceTimersByTimeAsync(0);
    expect(factory).toHaveBeenCalledTimes(9);
    expect(disposes.get("/ws/sessions/s0.jsonl")).toHaveBeenCalled(); // LRU
    expect(disposes.get("/ws/sessions/s1.jsonl")).not.toHaveBeenCalled();
    expect(posts).toContainEqual({ kind: "session_closed", sessionPath: "/ws/sessions/s0.jsonl", reason: "evicted" });
  });

  it("should not evict a streaming session, even when it is the oldest", async () => {
    vi.useFakeTimers();
    await fillSessions(8);
    const oldest = fakes.get("/ws/sessions/s0.jsonl");
    if (oldest) (oldest.session as { isStreaming: boolean }).isStreaming = true;

    command("/ws/sessions/s8.jsonl", { type: "get_state", id: "8" });
    await vi.advanceTimersByTimeAsync(0);
    expect(disposes.get("/ws/sessions/s0.jsonl")).not.toHaveBeenCalled(); // streaming — spared
    expect(disposes.get("/ws/sessions/s1.jsonl")).toHaveBeenCalled(); // oldest idle instead
  });

  it("should go over the cap when every session is streaming", async () => {
    vi.useFakeTimers();
    await fillSessions(8);
    for (const fake of fakes.values()) (fake.session as { isStreaming: boolean }).isStreaming = true;

    command("/ws/sessions/s8.jsonl", { type: "get_state", id: "8" });
    await vi.advanceTimersByTimeAsync(0);
    expect(factory).toHaveBeenCalledTimes(9);
    for (const dispose of disposes.values()) expect(dispose).not.toHaveBeenCalled();
  });
});
