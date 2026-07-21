import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHostNotice, AgentHostRequest } from "../../../shared/agentHost";
import { AgentHost, type HostRuntime, type HostSession } from "../host/host";

// Integration: the REAL router (main side) wired to the REAL AgentHost (the
// utilityProcess core) through an in-memory message channel standing in for
// utilityProcess.fork — only the pi SDK (RuntimeFactory) and Electron are
// faked. Specifies the full round trip the renderer sees: IPC command →
// router → host → session → serialized event line → "agent-event", plus the
// delete (dispose-ack-before-rm) and restart (kill → refork) flows.
type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sendToWindow: vi.fn(),
  fork: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  trackAgentFailed: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
  utilityProcess: { fork: h.fork },
}));
vi.mock("node:fs", () => ({ mkdirSync: h.mkdirSync, rmSync: h.rmSync }));
vi.mock("../../analytics", () => ({ trackAgentFailed: h.trackAgentFailed }));
vi.mock("../../env", () => ({
  workspaceDir: () => "/ws",
  sessionsDir: () => "/ws/sessions",
  agentEnv: () => ({ PATH: "/vendored/bin" }),
  agentHostEntryPath: () => "/out/main/agent-host.js",
  agentHostConfig: () => ({ workspaceDir: "/ws" }),
}));
// sessions.ts also pulls the pi SDK for SessionManager.list — not under test here.
vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: { list: async () => [] },
}));

const A = "/ws/sessions/a.jsonl";

/** A fake pi session (the only faked layer inside the host). */
function makeSession() {
  const listeners: Array<(event: object) => void> = [];
  const session = {
    prompt: vi.fn(async (_t: string, opts?: { preflightResult?: (ok: boolean) => void }) => {
      opts?.preflightResult?.(true);
    }),
    abort: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setThinkingLevel: vi.fn(),
    setSessionName: vi.fn(),
    subscribe: (fn: (event: object) => void) => {
      listeners.push(fn);
      return () => {};
    },
    modelRegistry: { getAvailable: async () => [{ provider: "anthropic", id: "claude" }] },
    model: { provider: "anthropic", id: "claude" },
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all",
    followUpMode: "all",
    sessionFile: A,
    sessionId: "sid",
    sessionName: "chat",
    autoCompactionEnabled: true,
    messages: [] as unknown[],
    pendingMessageCount: 0,
  };
  return {
    session,
    emit: (e: object) => {
      for (const fn of listeners) fn(e);
    },
  };
}

/** Live state of one fake "utilityProcess" running a real AgentHost. */
interface HostFixture {
  host: AgentHost;
  sessions: Map<string, ReturnType<typeof makeSession>>;
  disposes: Map<string, ReturnType<typeof vi.fn>>;
}
let fixtures: HostFixture[];

beforeEach(() => {
  h.handlers.clear();
  fixtures = [];
  // The in-memory utilityProcess: postMessage delivers to a REAL AgentHost;
  // the host's posts come back as "message" events; kill() emits "exit".
  h.fork.mockImplementation(() => {
    const proc = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: EventEmitter & { setEncoding: (enc: string) => void };
      stderr: EventEmitter & { setEncoding: (enc: string) => void };
      postMessage: (msg: AgentHostRequest) => void;
      kill: () => boolean;
    };
    proc.pid = 100 + fixtures.length;
    proc.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
    proc.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });

    const fixture: HostFixture = { host: undefined as never, sessions: new Map(), disposes: new Map() };
    fixture.host = new AgentHost({
      createRuntime: async (sessionPath): Promise<HostRuntime> => {
        const fake = makeSession();
        fixture.sessions.set(sessionPath, fake);
        const dispose = vi.fn(async () => {});
        fixture.disposes.set(sessionPath, dispose);
        return { session: fake.session as unknown as HostSession, dispose };
      },
      post: (notice: AgentHostNotice) => proc.emit("message", notice),
    });
    fixtures.push(fixture);

    proc.postMessage = (msg) => fixture.host.handleMessage(msg);
    proc.kill = () => {
      void fixture.host.disposeAll().then(() => proc.emit("exit", 0));
      return true;
    };
    return proc;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  const router = await import("../router");
  router.registerAgentIpc((() => ({ isDestroyed: () => false, webContents: { send: h.sendToWindow } })) as never);
  const sessions = await import("../sessions");
  sessions.registerSessionsIpc();
}

const invoke = (channel: string, payload?: unknown) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, payload);
};

/** agent-event lines the renderer received for a session, parsed. */
const rendererLines = (sessionPath: string): Record<string, unknown>[] =>
  h.sendToWindow.mock.calls
    .filter((c) => c[0] === "agent-event" && (c[1] as { sessionPath: string }).sessionPath === sessionPath)
    .map((c) => JSON.parse((c[1] as { line: string }).line));

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("renderer IPC → host → renderer events", () => {
  it("should round-trip a get_state request into a response line the bridge can correlate", async () => {
    await setup();
    invoke("agent_send", { sessionPath: A, command: { type: "get_state", id: "req-1" } });
    await flush();

    expect(rendererLines(A)).toEqual([
      {
        id: "req-1",
        type: "response",
        command: "get_state",
        success: true,
        data: expect.objectContaining({
          model: { provider: "anthropic", id: "claude" },
          thinkingLevel: "medium",
          isStreaming: false,
          sessionFile: A,
          sessionId: "sid",
          sessionName: "chat",
          messageCount: 0,
        }),
      },
    ]);
  });

  it("should stream a session's events to the renderer tagged with its path", async () => {
    await setup();
    invoke("agent_send", { sessionPath: A, command: { type: "prompt", message: "hi" } });
    await flush();

    fixtures[0].sessions.get(A)?.emit({ type: "agent_start" });
    fixtures[0].sessions.get(A)?.emit({ type: "message_update", message: { role: "assistant" } });

    const types = rendererLines(A).map((l) => l.type);
    expect(types).toContain("agent_start");
    expect(types).toContain("message_update");
    // The fire-and-forget prompt also produced its preflight success response.
    expect(rendererLines(A)).toContainEqual({ type: "response", command: "prompt", success: true });
  });

  it("should run set_model before a later get_state (queue order the renderer relies on)", async () => {
    await setup();
    invoke("agent_send", { sessionPath: A, command: { type: "set_model", provider: "anthropic", modelId: "claude" } });
    invoke("agent_send", { sessionPath: A, command: { type: "get_state", id: "req-2" } });
    await flush();

    expect(fixtures[0].sessions.get(A)?.session.setModel).toHaveBeenCalledWith({ provider: "anthropic", id: "claude" });
    const stateResponse = rendererLines(A).find((l) => l.id === "req-2");
    expect(stateResponse).toMatchObject({ success: true });
  });
});

describe("delete flow", () => {
  it("should abort + dispose the live session and ack before the file is removed", async () => {
    await setup();
    invoke("agent_send", { sessionPath: A, command: { type: "prompt", message: "go" } });
    await flush();

    await invoke("sessions_delete", { path: A });

    const fixture = fixtures[0];
    expect(fixture.sessions.get(A)?.session.abort).toHaveBeenCalled();
    expect(fixture.disposes.get(A)).toHaveBeenCalled();
    expect(h.rmSync).toHaveBeenCalledWith(A, { force: true });
    // Dispose completed before the rm (ack-gated, not fire-and-forget).
    const disposeOrder = fixture.disposes.get(A)?.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    const rmOrder = h.rmSync.mock.invocationCallOrder[0];
    expect(disposeOrder).toBeLessThan(rmOrder);
  });

  it("should delete a never-started session without involving the host", async () => {
    await setup();
    await invoke("sessions_delete", { path: A });
    expect(h.fork).not.toHaveBeenCalled();
    expect(h.rmSync).toHaveBeenCalledWith(A, { force: true });
  });
});

describe("restart flow", () => {
  it("should tear the host down on agent_restart and serve the next send from a fresh host", async () => {
    await setup();
    invoke("agent_send", { sessionPath: A, command: { type: "get_state", id: "1" } });
    await flush();

    invoke("agent_restart");
    await flush();
    // The old host disposed its sessions on kill, and no crash was reported.
    expect(fixtures[0].disposes.get(A)).toHaveBeenCalled();
    expect(h.sendToWindow.mock.calls.filter((c) => c[0] === "agent-terminated")).toEqual([]);
    expect(h.trackAgentFailed).not.toHaveBeenCalled();

    invoke("agent_send", { sessionPath: A, command: { type: "get_state", id: "2" } });
    await flush();
    expect(h.fork).toHaveBeenCalledTimes(2);
    // The second host built a brand-new session (fresh auth/models/skills).
    expect(fixtures[1].sessions.has(A)).toBe(true);
    expect(rendererLines(A).find((l) => l.id === "2")).toMatchObject({ success: true });
  });
});
