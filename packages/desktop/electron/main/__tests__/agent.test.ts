import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// agent.ts owns the pi child process: spawn args/env, the stdout JSONL→IPC
// bridge, the stderr tail, and crash-vs-intentional exit reporting. The child
// process, fs, Electron IPC, and env paths are the faked I/O boundaries; the
// bridging logic itself runs for real.
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
  trackAgentError: vi.fn(),
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
vi.mock("../analytics", () => ({ trackAgentError: h.trackAgentError }));
vi.mock("../env", () => ({
  workspaceDir: () => "/ws",
  agentEnv: () => ({ PATH: "/vendored/bin", ACCOUNTANT24_HOME: "/ws" }),
  piCliPath: () => "/pi/cli.js",
  extensionPath: () => "/res/ext.js",
}));

const win = { isDestroyed: () => false, webContents: { send: h.sendToWindow } };

let killAgent: () => void;

async function setup(getWin: () => unknown = () => win) {
  const mod = await import("../agent");
  killAgent = mod.killAgent;
  mod.registerAgentIpc(getWin as never);
}

const invoke = (channel: string, payload?: unknown) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, payload);
};

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
  vi.restoreAllMocks();
});

describe("agent_start", () => {
  it("should spawn pi in rpc mode with the bundled extension and workspace env", async () => {
    await setup();
    invoke("agent_start");

    expect(h.mkdirSync).toHaveBeenCalledWith("/ws", { recursive: true });
    expect(h.spawnCalls).toHaveLength(1);
    const { cmd, args, opts } = h.spawnCalls[0];
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([
      "/pi/cli.js",
      "--mode",
      "rpc",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--session-dir",
      "/ws/sessions",
      "-e",
      "/res/ext.js",
    ]);
    expect(opts.cwd).toBe("/ws");
    expect(opts.env).toMatchObject({ PATH: "/vendored/bin", ELECTRON_RUN_AS_NODE: "1" });
  });

  it("should not spawn a second child while one is running", async () => {
    await setup();
    invoke("agent_start");
    invoke("agent_start");
    expect(h.spawnCalls).toHaveLength(1);
  });

  it("should spawn again when started after a crash", async () => {
    await setup();
    invoke("agent_start");
    proc().emit("exit", 1, null);
    invoke("agent_start");
    expect(h.spawnCalls).toHaveLength(2);
  });
});

describe("stdout JSONL bridge", () => {
  it("should forward one agent-event per complete line", async () => {
    await setup();
    invoke("agent_start");
    proc().stdout.emit("data", '{"type":"a"}\n{"type":"b"}\n');
    expect(sent("agent-event")).toEqual(['{"type":"a"}', '{"type":"b"}']);
  });

  it("should buffer a partial line until its newline arrives in a later chunk", async () => {
    await setup();
    invoke("agent_start");
    proc().stdout.emit("data", '{"type":');
    expect(sent("agent-event")).toEqual([]);

    proc().stdout.emit("data", '"a"}\n');
    expect(sent("agent-event")).toEqual(['{"type":"a"}']);
  });

  it("should strip a trailing carriage return from a line", async () => {
    await setup();
    invoke("agent_start");
    proc().stdout.emit("data", '{"type":"a"}\r\n');
    expect(sent("agent-event")).toEqual(['{"type":"a"}']);
  });

  it("should skip empty lines", async () => {
    await setup();
    invoke("agent_start");
    proc().stdout.emit("data", '\n\n{"type":"a"}\n\n');
    expect(sent("agent-event")).toEqual(['{"type":"a"}']);
  });

  it("should not throw when no window is available", async () => {
    await setup(() => null);
    invoke("agent_start");
    expect(() => proc().stdout.emit("data", '{"type":"a"}\n')).not.toThrow();
  });
});

describe("agent_send", () => {
  it("should write the command as one JSON line to the child's stdin", async () => {
    await setup();
    invoke("agent_start");
    invoke("agent_send", { type: "prompt", message: "hi" });
    expect(proc().stdin.write).toHaveBeenCalledWith('{"type":"prompt","message":"hi"}\n');
  });

  it("should throw when the agent is not running", async () => {
    await setup();
    expect(() => invoke("agent_send", { type: "prompt" })).toThrow("agent not running");
  });

  it("should reject an undefined command instead of writing the literal text", async () => {
    await setup();
    invoke("agent_start");
    expect(() => invoke("agent_send", undefined)).toThrow("invalid agent command");
    expect(proc().stdin.write).not.toHaveBeenCalled();
  });

  it("should reject a null command", async () => {
    await setup();
    invoke("agent_start");
    expect(() => invoke("agent_send", null)).toThrow("invalid agent command");
  });
});

describe("crash reporting", () => {
  it("should report an unexpected exit with code, signal, and the stderr tail", async () => {
    await setup();
    invoke("agent_start");
    proc().stderr.emit("data", "boom line 1\nboom line 2\n");
    proc().emit("exit", 1, null);

    expect(sent("agent-terminated")).toEqual([{ code: 1, signal: null, stderr: "boom line 1\nboom line 2" }]);
  });

  it("should keep only the last 4000 characters of stderr", async () => {
    await setup();
    invoke("agent_start");
    proc().stderr.emit("data", "x".repeat(5000));
    proc().stderr.emit("data", "END");
    proc().emit("exit", 1, null);

    const [report] = sent("agent-terminated") as { stderr: string }[];
    expect(report.stderr).toHaveLength(4000);
    expect(report.stderr.endsWith("END")).toBe(true);
  });

  it("should forward a spawn error as agent-error", async () => {
    await setup();
    invoke("agent_start");
    proc().emit("error", new Error("spawn ENOENT"));
    expect(sent("agent-error")).toEqual(["spawn ENOENT"]);
  });

  it("should record a crash for analytics with kind only", async () => {
    await setup();
    invoke("agent_start");
    proc().emit("exit", 1, null);
    expect(h.trackAgentError).toHaveBeenCalledWith("crash");
  });

  it("should record a spawn error for analytics with kind only", async () => {
    await setup();
    invoke("agent_start");
    proc().emit("error", new Error("spawn ENOENT"));
    expect(h.trackAgentError).toHaveBeenCalledWith("spawn");
  });

  it("should not record an intentional stop as an error", async () => {
    await setup();
    invoke("agent_start");
    invoke("agent_stop");
    proc().emit("exit", null, "SIGTERM");
    expect(h.trackAgentError).not.toHaveBeenCalled();
  });
});

describe("intentional stops", () => {
  it("should kill the child and not report its exit when stopped", async () => {
    await setup();
    invoke("agent_start");
    invoke("agent_stop");
    expect(proc().kill).toHaveBeenCalled();

    proc().emit("exit", null, "SIGTERM");
    expect(sent("agent-terminated")).toEqual([]);
  });

  it("should spawn a replacement on restart and not report the old child's exit", async () => {
    await setup();
    invoke("agent_start");
    invoke("agent_restart");
    expect(h.spawnCalls).toHaveLength(2);

    proc(0).emit("exit", null, "SIGTERM");
    expect(sent("agent-terminated")).toEqual([]);
  });

  it("should not report either old child when two restarts overlap before their exits", async () => {
    await setup();
    invoke("agent_start");
    invoke("agent_restart"); // kills proc 0, spawns proc 1
    invoke("agent_restart"); // kills proc 1, spawns proc 2

    // Both killed children exit only now — neither is a crash.
    proc(0).emit("exit", null, "SIGTERM");
    proc(1).emit("exit", null, "SIGTERM");
    expect(sent("agent-terminated")).toEqual([]);
  });

  it("should still report a real crash of the current child after a restart", async () => {
    await setup();
    invoke("agent_start");
    invoke("agent_restart");
    proc(0).emit("exit", null, "SIGTERM"); // the intentional kill
    proc(1).emit("exit", 2, null); // the live child crashing
    expect(sent("agent-terminated")).toEqual([{ code: 2, signal: null, stderr: "" }]);
  });

  it("should do nothing when killAgent is called with no child running", async () => {
    await setup();
    expect(() => killAgent()).not.toThrow();
  });

  it("should allow a fresh start after an intentional stop", async () => {
    await setup();
    invoke("agent_start");
    invoke("agent_stop");
    proc(0).emit("exit", null, "SIGTERM");

    invoke("agent_start");
    expect(h.spawnCalls).toHaveLength(2);
  });
});
