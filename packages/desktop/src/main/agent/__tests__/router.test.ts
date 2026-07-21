import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHostNotice } from "../../../shared/agentHost";

// router.ts is the main-process side of the agent: it forks ONE agent-host
// utilityProcess lazily, routes commands to it, forwards its notices to the
// renderer, and turns a host exit into per-session crash reports. The
// utilityProcess, fs, Electron IPC, and env paths are the faked I/O
// boundaries; the routing logic itself runs for real.
type Handler = (event: unknown, payload?: unknown) => unknown;

/** A fake agent host: a real EventEmitter with stdio stream emitters. */
function makeProc(pid: number) {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter & { setEncoding: (enc: string) => void };
    stderr: EventEmitter & { setEncoding: (enc: string) => void };
    postMessage: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.pid = pid;
  proc.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  proc.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  proc.postMessage = vi.fn();
  proc.kill = vi.fn(() => true);
  return proc;
}
type FakeProc = ReturnType<typeof makeProc>;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sendToWindow: vi.fn(),
  fork: vi.fn(),
  forkCalls: [] as { modulePath: string; args: string[]; opts: Record<string, unknown> }[],
  procs: [] as unknown[],
  mkdirSync: vi.fn(),
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
vi.mock("node:fs", () => ({ mkdirSync: h.mkdirSync }));
vi.mock("../../analytics", () => ({ trackAgentFailed: h.trackAgentFailed }));
vi.mock("../../env", () => ({
  workspaceDir: () => "/ws",
  sessionsDir: () => "/ws/sessions",
  agentEnv: () => ({ PATH: "/vendored/bin", ACCOUNTANT24_HOME: "/ws", DROPPED: undefined }),
  agentHostEntryPath: () => "/out/main/agent-host.js",
  agentHostConfig: () => ({ workspaceDir: "/ws", sessionsDir: "/ws/sessions" }),
}));

const win = { isDestroyed: () => false, webContents: { send: h.sendToWindow } };

const A = "/ws/sessions/a.jsonl";
const B = "/ws/sessions/b.jsonl";

let killSessionAgent: (sessionPath: string) => Promise<void>;
let killAllAgents: () => void;

async function setup(getWin: () => unknown = () => win) {
  const mod = await import("../router");
  killSessionAgent = mod.killSessionAgent;
  killAllAgents = mod.killAllAgents;
  mod.registerAgentIpc(getWin as never);
}

const invoke = (channel: string, payload?: unknown) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, payload);
};

const send = (sessionPath: string, command: unknown = { type: "get_state" }) =>
  invoke("agent_send", { sessionPath, command });

/** The nth forked fake host (0-based). */
const proc = (n = 0) => h.procs[n] as FakeProc;

/** Post a host→main notice through the fake host. */
const notice = (n: AgentHostNotice, procIndex = 0) => proc(procIndex).emit("message", n);

/** Payloads sent to the renderer on the given channel. */
const sent = (channel: string): unknown[] => h.sendToWindow.mock.calls.filter((c) => c[0] === channel).map((c) => c[1]);

beforeEach(() => {
  h.handlers.clear();
  h.forkCalls.length = 0;
  h.procs.length = 0;
  h.fork.mockImplementation((modulePath: string, args: string[], opts: Record<string, unknown>) => {
    h.forkCalls.push({ modulePath, args, opts });
    const p = makeProc(100 + h.procs.length);
    h.procs.push(p);
    return p;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("agent_send", () => {
  it("should fork the agent host with the built entry, the JSON config argv, and the agent env", async () => {
    await setup();
    send(A);

    expect(h.mkdirSync).toHaveBeenCalledWith("/ws", { recursive: true });
    expect(h.forkCalls).toHaveLength(1);
    const { modulePath, args, opts } = h.forkCalls[0];
    expect(modulePath).toBe("/out/main/agent-host.js");
    expect(args).toEqual(['{"workspaceDir":"/ws","sessionsDir":"/ws/sessions"}']);
    expect(opts.cwd).toBe("/ws");
    expect(opts.serviceName).toBe("accountant24-agent-host");
    expect(opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    // Undefined env values are filtered; the Dock-icon-era ELECTRON_RUN_AS_NODE
    // must be gone.
    expect(opts.env).toEqual({ PATH: "/vendored/bin", ACCOUNTANT24_HOME: "/ws" });
  });

  it("should post the command to the host tagged with its session path", async () => {
    await setup();
    send(A, { type: "prompt", message: "hi" });
    expect(proc().postMessage).toHaveBeenCalledWith({
      kind: "command",
      sessionPath: A,
      command: { type: "prompt", message: "hi" },
    });
  });

  it("should reuse the running host across sends and sessions", async () => {
    await setup();
    send(A);
    send(B);
    send(A, { type: "prompt", message: "again" });
    expect(h.forkCalls).toHaveLength(1);
    expect(proc().postMessage).toHaveBeenCalledTimes(3);
  });

  it("should fork a replacement host on the next send after a crash", async () => {
    await setup();
    send(A);
    proc().emit("exit", 1);
    send(A);
    expect(h.forkCalls).toHaveLength(2);
  });

  it("should reject a session path outside the sessions directory", async () => {
    await setup();
    expect(() => send("/etc/passwd")).toThrow("session path outside the sessions directory");
    expect(h.forkCalls).toHaveLength(0);
  });

  it("should reject a path that merely shares the sessions dir prefix", async () => {
    await setup();
    expect(() => send("/ws/sessions-backup/a.jsonl")).toThrow("session path outside the sessions directory");
  });

  it("should reject a missing session path", async () => {
    await setup();
    expect(() => invoke("agent_send", { command: { type: "get_state" } })).toThrow("session path is required");
  });

  it("should reject an undefined command", async () => {
    await setup();
    expect(() => invoke("agent_send", { sessionPath: A })).toThrow("invalid agent command");
    expect(h.forkCalls).toHaveLength(0);
  });

  it("should reject a null command", async () => {
    await setup();
    expect(() => invoke("agent_send", { sessionPath: A, command: null })).toThrow("invalid agent command");
  });
});

describe("agent_create_session", () => {
  it("should mint a fresh .jsonl path inside the sessions dir without forking", async () => {
    await setup();
    const path = invoke("agent_create_session") as string;
    expect(path).toMatch(/^\/ws\/sessions\/.+\.jsonl$/);
    expect(h.mkdirSync).toHaveBeenCalledWith("/ws/sessions", { recursive: true });
    expect(h.forkCalls).toHaveLength(0);
  });

  it("should mint a distinct path per call", async () => {
    await setup();
    const first = invoke("agent_create_session");
    const second = invoke("agent_create_session");
    expect(first).not.toEqual(second);
  });
});

describe("host notices", () => {
  it("should forward an event notice verbatim as agent-event", async () => {
    await setup();
    send(A);
    notice({ kind: "event", sessionPath: A, line: '{"type":"agent_start"}' });
    expect(sent("agent-event")).toEqual([{ sessionPath: A, line: '{"type":"agent_start"}' }]);
  });

  it("should keep each session's events tagged with its own path", async () => {
    await setup();
    send(A);
    send(B);
    notice({ kind: "event", sessionPath: A, line: '{"type":"a"}' });
    notice({ kind: "event", sessionPath: B, line: '{"type":"b"}' });
    expect(sent("agent-event")).toEqual([
      { sessionPath: A, line: '{"type":"a"}' },
      { sessionPath: B, line: '{"type":"b"}' },
    ]);
  });

  it("should forward a session_error as agent-error and record it for analytics", async () => {
    await setup();
    send(A);
    notice({ kind: "session_error", sessionPath: A, message: "extension exploded" });
    expect(sent("agent-error")).toEqual([{ sessionPath: A, message: "extension exploded" }]);
    expect(h.trackAgentFailed).toHaveBeenCalledWith("spawn");
  });

  it("should not throw when no window is available", async () => {
    await setup(() => null);
    send(A);
    expect(() => notice({ kind: "event", sessionPath: A, line: "{}" })).not.toThrow();
  });
});

describe("crash reporting", () => {
  it("should report an unexpected exit to every live session with code and the stderr tail", async () => {
    await setup();
    send(A);
    send(B);
    proc().stderr.emit("data", "boom line 1\nboom line 2\n");
    proc().emit("exit", 1);

    expect(sent("agent-terminated")).toEqual([
      { sessionPath: A, code: 1, signal: null, stderr: "boom line 1\nboom line 2" },
      { sessionPath: B, code: 1, signal: null, stderr: "boom line 1\nboom line 2" },
    ]);
  });

  it("should record one crash for analytics however many sessions were live", async () => {
    await setup();
    send(A);
    send(B);
    proc().emit("exit", 1);
    expect(h.trackAgentFailed).toHaveBeenCalledTimes(1);
    expect(h.trackAgentFailed).toHaveBeenCalledWith("crash");
  });

  it("should keep only the last 4000 characters of stderr", async () => {
    await setup();
    send(A);
    proc().stderr.emit("data", "x".repeat(5000));
    proc().stderr.emit("data", "END");
    proc().emit("exit", 1);

    const [report] = sent("agent-terminated") as { stderr: string }[];
    expect(report.stderr).toHaveLength(4000);
    expect(report.stderr.endsWith("END")).toBe(true);
  });

  it("should not report a session the host had already closed", async () => {
    await setup();
    send(A);
    send(B);
    notice({ kind: "session_closed", sessionPath: A, reason: "reaped" });
    proc().emit("exit", 1);

    expect(sent("agent-terminated")).toEqual([{ sessionPath: B, code: 1, signal: null, stderr: "" }]);
  });
});

describe("intentional stops", () => {
  it("should kill the host on killAllAgents without reporting a crash", async () => {
    await setup();
    send(A);
    killAllAgents();
    expect(proc().kill).toHaveBeenCalled();
    proc().emit("exit", 0);
    expect(sent("agent-terminated")).toEqual([]);
    expect(h.trackAgentFailed).not.toHaveBeenCalled();
  });

  it("should kill the host on agent_restart and refork lazily on the next send", async () => {
    await setup();
    send(A);
    invoke("agent_restart");
    expect(proc(0).kill).toHaveBeenCalled();
    proc(0).emit("exit", 0);
    expect(sent("agent-terminated")).toEqual([]);

    send(A);
    expect(h.forkCalls).toHaveLength(2);
  });

  it("should still report a real crash of the replacement host after a restart", async () => {
    await setup();
    send(A);
    invoke("agent_restart");
    send(A);
    proc(0).emit("exit", 0); // the intentional kill settling late
    proc(1).emit("exit", 2); // the live replacement crashing

    expect(sent("agent-terminated")).toEqual([{ sessionPath: A, code: 2, signal: null, stderr: "" }]);
    expect(h.trackAgentFailed).toHaveBeenCalledTimes(1);
  });

  it("should do nothing when killAllAgents is called with no host", async () => {
    await setup();
    expect(() => killAllAgents()).not.toThrow();
  });
});

describe("killSessionAgent", () => {
  it("should resolve immediately when no host is running", async () => {
    await setup();
    await expect(killSessionAgent(A)).resolves.toBeUndefined();
  });

  it("should resolve immediately for a session never routed to the host", async () => {
    await setup();
    send(A);
    await expect(killSessionAgent(B)).resolves.toBeUndefined();
    expect(proc().postMessage).toHaveBeenCalledTimes(1); // only the send, no dispose
  });

  it("should post a dispose_session and resolve on the host's ack", async () => {
    await setup();
    send(A);
    const pending = killSessionAgent(A);

    const dispose = proc().postMessage.mock.calls.at(-1)?.[0] as {
      kind: string;
      sessionPath: string;
      requestId: string;
    };
    expect(dispose).toMatchObject({ kind: "dispose_session", sessionPath: A });
    notice({ kind: "session_closed", sessionPath: A, reason: "disposed", requestId: dispose.requestId });
    await expect(pending).resolves.toBeUndefined();
  });

  it("should resolve after the timeout when the host never acks", async () => {
    vi.useFakeTimers();
    await setup();
    send(A);
    const pending = killSessionAgent(A);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBeUndefined();
  });

  it("should resolve when the host dies before acking", async () => {
    await setup();
    send(A);
    const pending = killSessionAgent(A);
    proc().emit("exit", 1);
    await expect(pending).resolves.toBeUndefined();
  });
});
