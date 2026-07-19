// The pi agent child processes — ONE PER SESSION, so a run in chat A keeps
// going while the user works in chat B (pi's RPC mode is single-active-session
// per process; switch_session would abort the in-flight run).
//
// Each child is `pi --mode rpc --session <sessionPath>` bridging JSONL stdio:
//
//   stdout line  -> "agent-event" { sessionPath, line }
//   "agent_send" { sessionPath, command } -> one JSON command to that child's
//                                            stdin (+ "\n"), spawning on demand
//
// `--session <path>` opens an existing session file OR starts a fresh session
// at a not-yet-existing path (pi dist/main.js resolveSessionPath treats any
// path-like arg as type:"path"; SessionManager.open keeps the explicit path and
// only flushes the file once an assistant message exists — verified for the
// vendored 0.79.x). That lets the app mint session paths up front
// (agent_create_session) and use the same spawn code for new chats, reopened
// chats, and respawns after idle-reap/crash — history, model, and thinking
// level all restore from the session file.
//
// Option B: instead of a compiled pi binary, we run pi's cli.js with Electron's
// own Node (ELECTRON_RUN_AS_NODE), resolved from node_modules.

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { type BrowserWindow, ipcMain } from "electron";
import { trackAgentFailed } from "./analytics";
import {
  agentEnv,
  extensionPath,
  nativeSkillsDir,
  nodeRuntimePath,
  piCliPath,
  sessionsDir,
  skillsDir,
  systemPromptPath,
  workspaceDir,
} from "./env";
import { resolveSessionPath } from "./sessionPaths";
import { buildSkillArgs } from "./skills-store";

interface AgentChild {
  proc: ChildProcess;
  /** A run is in flight (between agent_start and agent_end) — never reap. */
  running: boolean;
  /** Last stdin write or stdout line, for the idle reaper. */
  lastActivity: number;
}

/** Live children, keyed by their session file's absolute path. */
const children = new Map<string, AgentChild>();
// Children we deliberately killed (reap / restart / delete / app quit), so
// their `exit` isn't reported to the renderer as a crash. A set, not a single
// slot: several killed children can still be awaiting their exit event.
const intentionalKills = new Set<ChildProcess>();

/** Kill idle children after this long without stdio activity. */
const IDLE_TTL_MS = 15 * 60_000;
/** Soft cap on live children; above it, spawning evicts the LRU idle child. */
const MAX_CHILDREN = 8;
const REAP_INTERVAL_MS = 60_000;

/** Reject session paths outside the sessions dir — the path becomes a spawn
 *  argument. */
function assertSessionPath(sessionPath: unknown): string {
  if (typeof sessionPath !== "string" || sessionPath.length === 0) {
    throw new Error("session path is required");
  }
  const target = resolveSessionPath(sessionPath);
  if (!target) throw new Error("session path outside the sessions directory");
  return target;
}

/** Mint a fresh session file path (no spawn — the first send does that). */
function createSessionPath(): string {
  mkdirSync(sessionsDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(sessionsDir(), `${stamp}_${randomUUID()}.jsonl`);
}

function spawnAgent(sessionPath: string, getWin: () => BrowserWindow | null): AgentChild {
  const workspace = workspaceDir();
  // current_dir requires the dir to exist at spawn time (the extension scaffolds
  // its contents later, on session_start).
  mkdirSync(workspace, { recursive: true });

  const proc = spawn(
    nodeRuntimePath(),
    [
      piCliPath(),
      "--mode",
      "rpc",
      "--no-extensions",
      // Skills load from EXACTLY two places: the native dir embedded in the
      // app bundle and the workspace skills folder (third-party installs).
      // --no-skills removes every other channel — default discovery
      // (agentDir/skills, .pi/skills), settings.json skills[]/packages[] —
      // leaving only the explicit --skill flags below; skills bundled inside
      // `-e` extension *sources* would also load, but our only -e is a plain
      // local .js file (pi resource-loader.js:277, verified for 0.79.8).
      "--no-skills",
      "--no-prompt-templates",
      // pi replaces its coding-agent preamble with system.md but still
      // assembles its native sections (<available_skills>, date/cwd) around
      // it; the extension appends the dynamic tools/context per turn.
      "--system-prompt",
      systemPromptPath(),
      // Native (built-in) skills: always on, one flag for the whole dir.
      "--skill",
      nativeSkillsDir(),
      ...buildSkillArgs(skillsDir()),
      "--session-dir",
      sessionsDir(),
      // This child's one-and-only session (see header).
      "--session",
      sessionPath,
      "-e",
      extensionPath(),
    ],
    {
      cwd: workspace,
      env: { ...agentEnv(), ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const child: AgentChild = { proc, running: false, lastActivity: Date.now() };
  children.set(sessionPath, child);
  console.log(`[agent] spawned (pid ${proc.pid}) for ${sessionPath}`);

  const emit = (channel: string, payload: unknown) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  // stdout is newline-delimited JSON; forward each complete line.
  let buf = "";
  proc.stdout?.setEncoding("utf8");
  proc.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line.length === 0) continue;
      child.lastActivity = Date.now();
      // Run-state sniff for the reaper: a substring pre-check keeps the parse
      // off streaming-delta lines, and the parse confirms the type (a delta
      // whose text merely mentions the marker parses to a different type).
      // Content-based on purpose — a byte-length gate would silently stop
      // matching if pi ever added fields to these events, and the reaper
      // would then kill children mid-run.
      if (line.includes('"agent_start"') || line.includes('"agent_end"')) {
        try {
          const type = (JSON.parse(line) as { type?: string }).type;
          if (type === "agent_start") child.running = true;
          else if (type === "agent_end") child.running = false;
        } catch {
          // not JSON / partial — the renderer's parser deals with it
        }
      }
      emit("agent-event", { sessionPath, line });
    }
  });
  // Keep a rolling tail of stderr so a crash can report a diagnostic instead of
  // just an exit code (and so the pipe never blocks).
  let stderrTail = "";
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
  });
  proc.on("exit", (code, signal) => {
    if (children.get(sessionPath)?.proc === proc) children.delete(sessionPath);
    // Kills we initiated (reap / restart / delete / app quit) aren't crashes —
    // don't surface them.
    if (intentionalKills.delete(proc)) {
      console.log(`[agent] stopped (intentional) for ${sessionPath}`);
      return;
    }
    console.error(`[agent] crashed: code=${code} signal=${signal} session=${sessionPath}`);
    if (stderrTail.trim()) console.error(`[agent] stderr tail:\n${stderrTail.trim()}`);
    trackAgentFailed("crash");
    emit("agent-terminated", { sessionPath, code, signal, stderr: stderrTail.trim() });
  });
  proc.on("error", (err) => {
    console.error(`[agent] spawn error: ${err.message}`);
    trackAgentFailed("spawn");
    emit("agent-error", { sessionPath, message: err.message });
  });
  return child;
}

function killChild(sessionPath: string, child: AgentChild): void {
  intentionalKills.add(child.proc);
  child.proc.kill();
  children.delete(sessionPath);
}

/** Kill one session's agent child, if it has one (session delete / stop). */
export function killSessionAgent(sessionPath: string): void {
  const target = resolve(sessionPath);
  const child = children.get(target);
  if (child) killChild(target, child);
}

/** Kill every agent child (app exit / restart after provider/skills changes). */
export function killAllAgents(): void {
  for (const [sessionPath, child] of children) killChild(sessionPath, child);
}

/** Kill idle children past the TTL. Never touches a child with a run in flight. */
function reapIdle(): void {
  const now = Date.now();
  for (const [sessionPath, child] of children) {
    if (!child.running && now - child.lastActivity > IDLE_TTL_MS) {
      console.log(`[agent] reaping idle child for ${sessionPath}`);
      killChild(sessionPath, child);
    }
  }
}

/** Above the cap, evict the least-recently-active idle child to make room. */
function evictForCap(): void {
  while (children.size >= MAX_CHILDREN) {
    let lru: [string, AgentChild] | undefined;
    for (const entry of children) {
      if (entry[1].running) continue;
      if (!lru || entry[1].lastActivity < lru[1].lastActivity) lru = entry;
    }
    if (!lru) return; // everything is running — let the spawn go over the cap
    console.log(`[agent] evicting idle child for ${lru[0]}`);
    killChild(lru[0], lru[1]);
  }
}

/** Register agent IPC + the idle reaper. */
export function registerAgentIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle("agent_send", (_e, payload: unknown) => {
    const { sessionPath, command } = (payload ?? {}) as { sessionPath?: unknown; command?: unknown };
    const target = assertSessionPath(sessionPath);
    // JSON.stringify(undefined) is undefined, which would write the literal
    // text "undefined" and corrupt the JSONL stream — commands must be objects.
    if (typeof command !== "object" || command === null) throw new Error("invalid agent command");
    let child = children.get(target);
    if (!child) {
      evictForCap();
      child = spawnAgent(target, getWin);
    }
    child.lastActivity = Date.now();
    // stdin always exists: the spawn pipes all three stdio streams.
    child.proc.stdin?.write(`${JSON.stringify(command)}\n`);
  });
  ipcMain.handle("agent_create_session", () => createSessionPath());
  // Kill every child so the next send respawns with fresh auth.json +
  // models.json — used after the app adds/removes a provider, since the agent
  // caches both in memory at startup. Respawn is lazy (each send carries its
  // session path), so nothing to restart eagerly.
  ipcMain.handle("agent_restart", () => killAllAgents());
  setInterval(reapIdle, REAP_INTERVAL_MS).unref();
}
