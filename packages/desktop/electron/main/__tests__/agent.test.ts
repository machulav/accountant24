import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// agent.ts owns the pi child processes — one per session: spawn args/env, the
// per-session stdout JSONL→IPC bridge (events tagged with sessionPath), the
// stderr tail, crash-vs-intentional exit reporting, and the idle reaper. The
// child process, fs, Electron IPC, and env paths are the faked I/O boundaries;
// the bridging logic itself runs for real.
type Handler = (event: unknown, payload?: unknown) => unknown;

/** A fake pi child: real EventEmitters for the process and its stdio streams. */
function makeProc(pid: number) {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter & { setEncoding: (enc: string) => void };
    stderr: EventEmitter & { setEncoding: (enc: string) => void };
    stdin: { write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.pid = pid;
  proc.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  proc.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  proc.stdin = { write: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}
type FakeProc = ReturnType<typeof makeProc>;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sendToWindow: vi.fn(),
  spawn: vi.fn(),
  spawnCalls: [] as { cmd: string; args: string[]; opts: Record<string, unknown> }[],
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
}));
vi.mock("node:child_process", () => ({ spawn: h.spawn }));
vi.mock("node:fs", () => ({ mkdirSync: h.mkdirSync }));
vi.mock("../analytics", () => ({ trackAgentFailed: h.trackAgentFailed }));
vi.mock("../env", () => ({
  workspaceDir: () => "/ws",
  sessionsDir: () => "/ws/sessions",
  skillsDir: () => "/ws/skills",
  nativeSkillsDir: () => "/res/skills",
  agentEnv: () => ({ PATH: "/vendored/bin", ACCOUNTANT24_HOME: "/ws" }),
  piCliPath: () => "/pi/cli.js",
  extensionPath: () => "/res/ext.js",
  systemPromptPath: () => "/res/system.md",
  nodeRuntimePath: () => "/node-runtime",
}));
vi.mock("../skills-store", () => ({
  buildSkillArgs: (root: string) => (root === "/ws/skills" ? ["--skill", "/ws/skills/pdf"] : ["WRONG-ARGS"]),
}));

const win = { isDestroyed: () => false, webContents: { send: h.sendToWindow } };

const A = "/ws/sessions/a.jsonl";
const B = "/ws/sessions/b.jsonl";

let killSessionAgent: (sessionPath: string) => void;
let killAllAgents: () => void;

async function setup(getWin: () => unknown = () => win) {
  const mod = await import("../agent");
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

/** The nth spawned fake child (0-based). */
const proc = (n = 0) => h.procs[n] as FakeProc;

/** Payloads sent to the renderer on the given channel. */
const sent = (channel: string): unknown[] => h.sendToWindow.mock.calls.filter((c) => c[0] === channel).map((c) => c[1]);

beforeEach(() => {
  h.handlers.clear();
  h.spawnCalls.length = 0;
  h.procs.length = 0;
  h.spawn.mockImplementation((cmd: string, args: string[], opts: Record<string, unknown>) => {
    h.spawnCalls.push({ cmd, args, opts });
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
  it("should spawn pi in rpc mode with the system prompt, enabled skills, the session file, and bundled extension", async () => {
    await setup();
    send(A);

    expect(h.mkdirSync).toHaveBeenCalledWith("/ws", { recursive: true });
    expect(h.spawnCalls).toHaveLength(1);
    const { cmd, args, opts } = h.spawnCalls[0];
    expect(cmd).toBe("/node-runtime");
    expect(args).toEqual([
      "/pi/cli.js",
      "--mode",
      "rpc",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--system-prompt",
      "/res/system.md",
      "--skill",
      "/res/skills",
      "--skill",
      "/ws/skills/pdf",
      "--session-dir",
      "/ws/sessions",
      "--session",
      A,
      "-e",
      "/res/ext.js",
    ]);
    expect(opts.cwd).toBe("/ws");
    expect(opts.env).toMatchObject({ PATH: "/vendored/bin", ELECTRON_RUN_AS_NODE: "1" });
  });

  it("should write the command as one JSON line to the child's stdin", async () => {
    await setup();
    send(A, { type: "prompt", message: "hi" });
    expect(proc().stdin.write).toHaveBeenCalledWith('{"type":"prompt","message":"hi"}\n');
  });

  it("should reuse the running child on a second send to the same session", async () => {
    await setup();
    send(A);
    send(A, { type: "prompt", message: "again" });
    expect(h.spawnCalls).toHaveLength(1);
    expect(proc().stdin.write).toHaveBeenCalledTimes(2);
  });

  it("should spawn one child per session and route each send to its own child", async () => {
    await setup();
    send(A, { type: "prompt", message: "for A" });
    send(B, { type: "prompt", message: "for B" });

    expect(h.spawnCalls).toHaveLength(2);
    expect(h.spawnCalls[0].args).toContain(A);
    expect(h.spawnCalls[1].args).toContain(B);
    expect(proc(0).stdin.write).toHaveBeenCalledWith('{"type":"prompt","message":"for A"}\n');
    expect(proc(1).stdin.write).toHaveBeenCalledWith('{"type":"prompt","message":"for B"}\n');
  });

  it("should spawn a replacement on the next send after a crash", async () => {
    await setup();
    send(A);
    proc().emit("exit", 1, null);
    send(A);
    expect(h.spawnCalls).toHaveLength(2);
  });

  it("should reject a session path outside the sessions directory", async () => {
    await setup();
    expect(() => send("/etc/passwd")).toThrow("session path outside the sessions directory");
    expect(h.spawnCalls).toHaveLength(0);
  });

  it("should reject a path that merely shares the sessions dir prefix", async () => {
    await setup();
    expect(() => send("/ws/sessions-backup/a.jsonl")).toThrow("session path outside the sessions directory");
  });

  it("should reject a missing session path", async () => {
    await setup();
    expect(() => invoke("agent_send", { command: { type: "get_state" } })).toThrow("session path is required");
  });

  it("should reject an undefined command instead of writing the literal text", async () => {
    await setup();
    expect(() => invoke("agent_send", { sessionPath: A })).toThrow("invalid agent command");
    expect(h.spawnCalls).toHaveLength(0);
  });

  it("should reject a null command", async () => {
    await setup();
    expect(() => invoke("agent_send", { sessionPath: A, command: null })).toThrow("invalid agent command");
  });
});

describe("agent_create_session", () => {
  it("should mint a fresh .jsonl path inside the sessions dir without spawning", async () => {
    await setup();
    const path = invoke("agent_create_session") as string;
    expect(path).toMatch(/^\/ws\/sessions\/.+\.jsonl$/);
    expect(h.mkdirSync).toHaveBeenCalledWith("/ws/sessions", { recursive: true });
    expect(h.spawnCalls).toHaveLength(0);
  });

  it("should mint a distinct path per call", async () => {
    await setup();
    const first = invoke("agent_create_session");
    const second = invoke("agent_create_session");
    expect(first).not.toEqual(second);
  });
});

describe("stdout JSONL bridge", () => {
  it("should forward one agent-event per complete line, tagged with the session", async () => {
    await setup();
    send(A);
    proc().stdout.emit("data", '{"type":"a"}\n{"type":"b"}\n');
    expect(sent("agent-event")).toEqual([
      { sessionPath: A, line: '{"type":"a"}' },
      { sessionPath: A, line: '{"type":"b"}' },
    ]);
  });

  it("should tag each session's events with its own path when two children stream", async () => {
    await setup();
    send(A);
    send(B);
    proc(0).stdout.emit("data", '{"type":"a"}\n');
    proc(1).stdout.emit("data", '{"type":"b"}\n');
    expect(sent("agent-event")).toEqual([
      { sessionPath: A, line: '{"type":"a"}' },
      { sessionPath: B, line: '{"type":"b"}' },
    ]);
  });

  it("should buffer a partial line until its newline arrives in a later chunk", async () => {
    await setup();
    send(A);
    proc().stdout.emit("data", '{"type":');
    expect(sent("agent-event")).toEqual([]);

    proc().stdout.emit("data", '"a"}\n');
    expect(sent("agent-event")).toEqual([{ sessionPath: A, line: '{"type":"a"}' }]);
  });

  it("should strip a trailing carriage return from a line", async () => {
    await setup();
    send(A);
    proc().stdout.emit("data", '{"type":"a"}\r\n');
    expect(sent("agent-event")).toEqual([{ sessionPath: A, line: '{"type":"a"}' }]);
  });

  it("should skip empty lines", async () => {
    await setup();
    send(A);
    proc().stdout.emit("data", '\n\n{"type":"a"}\n\n');
    expect(sent("agent-event")).toEqual([{ sessionPath: A, line: '{"type":"a"}' }]);
  });

  it("should not throw when no window is available", async () => {
    await setup(() => null);
    send(A);
    expect(() => proc().stdout.emit("data", '{"type":"a"}\n')).not.toThrow();
  });
});

describe("crash reporting", () => {
  it("should report an unexpected exit with the session, code, signal, and the stderr tail", async () => {
    await setup();
    send(A);
    proc().stderr.emit("data", "boom line 1\nboom line 2\n");
    proc().emit("exit", 1, null);

    expect(sent("agent-terminated")).toEqual([
      { sessionPath: A, code: 1, signal: null, stderr: "boom line 1\nboom line 2" },
    ]);
  });

  it("should keep only the last 4000 characters of stderr", async () => {
    await setup();
    send(A);
    proc().stderr.emit("data", "x".repeat(5000));
    proc().stderr.emit("data", "END");
    proc().emit("exit", 1, null);

    const [report] = sent("agent-terminated") as { stderr: string }[];
    expect(report.stderr).toHaveLength(4000);
    expect(report.stderr.endsWith("END")).toBe(true);
  });

  it("should forward a spawn error as agent-error with the session", async () => {
    await setup();
    send(A);
    proc().emit("error", new Error("spawn ENOENT"));
    expect(sent("agent-error")).toEqual([{ sessionPath: A, message: "spawn ENOENT" }]);
  });

  it("should record a crash for analytics with kind only", async () => {
    await setup();
    send(A);
    proc().emit("exit", 1, null);
    expect(h.trackAgentFailed).toHaveBeenCalledWith("crash");
  });

  it("should record a spawn error for analytics with kind only", async () => {
    await setup();
    send(A);
    proc().emit("error", new Error("spawn ENOENT"));
    expect(h.trackAgentFailed).toHaveBeenCalledWith("spawn");
  });

  it("should not touch the other session's child when one crashes", async () => {
    await setup();
    send(A);
    send(B);
    proc(0).emit("exit", 1, null);

    expect(proc(1).kill).not.toHaveBeenCalled();
    send(B); // still routed to the live child, no respawn
    expect(h.spawnCalls).toHaveLength(2);
  });
});

describe("intentional stops", () => {
  it("should kill only the given session's child on killSessionAgent", async () => {
    await setup();
    send(A);
    send(B);
    killSessionAgent(A);

    expect(proc(0).kill).toHaveBeenCalled();
    expect(proc(1).kill).not.toHaveBeenCalled();
    proc(0).emit("exit", null, "SIGTERM");
    expect(sent("agent-terminated")).toEqual([]);
    expect(h.trackAgentFailed).not.toHaveBeenCalled();
  });

  it("should kill every child on killAllAgents", async () => {
    await setup();
    send(A);
    send(B);
    killAllAgents();
    expect(proc(0).kill).toHaveBeenCalled();
    expect(proc(1).kill).toHaveBeenCalled();
  });

  it("should kill every child on agent_restart and respawn lazily on the next send", async () => {
    await setup();
    send(A);
    send(B);
    invoke("agent_restart");
    expect(proc(0).kill).toHaveBeenCalled();
    expect(proc(1).kill).toHaveBeenCalled();

    proc(0).emit("exit", null, "SIGTERM");
    proc(1).emit("exit", null, "SIGTERM");
    expect(sent("agent-terminated")).toEqual([]);

    send(A);
    expect(h.spawnCalls).toHaveLength(3);
  });

  it("should still report a real crash of a replacement child after a restart", async () => {
    await setup();
    send(A);
    invoke("agent_restart");
    proc(0).emit("exit", null, "SIGTERM"); // the intentional kill
    send(A);
    proc(1).emit("exit", 2, null); // the live replacement crashing
    expect(sent("agent-terminated")).toEqual([{ sessionPath: A, code: 2, signal: null, stderr: "" }]);
  });

  it("should do nothing when killSessionAgent is called with no child running", async () => {
    await setup();
    expect(() => killSessionAgent(A)).not.toThrow();
  });

  it("should do nothing when killAllAgents is called with no children", async () => {
    await setup();
    expect(() => killAllAgents()).not.toThrow();
  });

  it("should allow a fresh send after an intentional stop", async () => {
    await setup();
    send(A);
    killSessionAgent(A);
    proc(0).emit("exit", null, "SIGTERM");

    send(A);
    expect(h.spawnCalls).toHaveLength(2);
  });
});

describe("idle reaper", () => {
  it("should kill an idle child after the idle TTL without reporting a crash", async () => {
    vi.useFakeTimers();
    await setup();
    send(A);

    vi.advanceTimersByTime(16 * 60_000);
    expect(proc().kill).toHaveBeenCalled();
    proc().emit("exit", null, "SIGTERM");
    expect(sent("agent-terminated")).toEqual([]);
  });

  it("should never reap a child with a run in flight, however long it runs", async () => {
    vi.useFakeTimers();
    await setup();
    send(A, { type: "prompt", message: "go" });
    proc().stdout.emit("data", '{"type":"agent_start"}\n');

    vi.advanceTimersByTime(60 * 60_000);
    expect(proc().kill).not.toHaveBeenCalled();
  });

  it("should reap a child once its run ended and the TTL passed", async () => {
    vi.useFakeTimers();
    await setup();
    send(A, { type: "prompt", message: "go" });
    proc().stdout.emit("data", '{"type":"agent_start"}\n');
    vi.advanceTimersByTime(30 * 60_000);
    proc().stdout.emit("data", '{"type":"agent_end"}\n');

    vi.advanceTimersByTime(16 * 60_000);
    expect(proc().kill).toHaveBeenCalled();
  });

  it("should keep a child alive while sends keep arriving within the TTL", async () => {
    vi.useFakeTimers();
    await setup();
    send(A);
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(10 * 60_000);
      send(A);
    }
    expect(proc().kill).not.toHaveBeenCalled();
  });

  it("should evict the least-recently-active idle child when the cap is reached", async () => {
    vi.useFakeTimers();
    await setup();
    // Fill the cap (8) with idle children, oldest activity first.
    for (let i = 0; i < 8; i += 1) {
      send(`/ws/sessions/s${i}.jsonl`);
      vi.advanceTimersByTime(1000);
    }
    expect(h.spawnCalls).toHaveLength(8);

    send("/ws/sessions/s8.jsonl");
    expect(h.spawnCalls).toHaveLength(9);
    expect(proc(0).kill).toHaveBeenCalled(); // s0: least recently active
    expect(proc(1).kill).not.toHaveBeenCalled();
  });

  it("should not evict a running child for the cap, even when it is the oldest", async () => {
    vi.useFakeTimers();
    await setup();
    send("/ws/sessions/s0.jsonl", { type: "prompt", message: "go" });
    proc(0).stdout.emit("data", '{"type":"agent_start"}\n');
    vi.advanceTimersByTime(1000);
    for (let i = 1; i < 8; i += 1) {
      send(`/ws/sessions/s${i}.jsonl`);
      vi.advanceTimersByTime(1000);
    }

    send("/ws/sessions/s8.jsonl");
    expect(proc(0).kill).not.toHaveBeenCalled(); // running — spared
    expect(proc(1).kill).toHaveBeenCalled(); // oldest idle instead
  });
});
