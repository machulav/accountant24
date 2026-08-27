// Main-process side of the agent: a thin router in front of ONE agent-host
// utilityProcess (agent/host/) that runs every chat's pi SDK session.
//
//   renderer "agent_send" { sessionPath, command }  ->  postMessage to the host
//   host "event" { sessionPath, line }              ->  "agent-event" verbatim
//
// The host is forked lazily on the first send and killed to reload config
// (agent_restart after provider/skills changes — the host caches auth.json/
// models.json/skills at session creation). A host crash fans out one
// "agent-terminated" per live session; the next send re-forks.

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { type BrowserWindow, ipcMain, type UtilityProcess, utilityProcess } from "electron";
import type { AgentHostNotice, AgentHostRequest } from "../../shared/agentHost";
import { trackAgentFailed } from "../analytics";
import { agentEnv, agentHostConfig, agentHostEntryPath, sessionsDir, workspaceDir } from "../env";
import { agentSkills } from "./plugins";
import { resolveSessionPath } from "./session-paths";

/** How long a session delete waits for the host's dispose ack before
 *  proceeding anyway (the host may be dead or wedged — never hang a delete). */
const DISPOSE_ACK_TIMEOUT_MS = 3000;

/** One forked host and the state scoped to its lifetime. Per-host (not
 *  module-level) so a killed host's late exit event can't clobber the state of
 *  the replacement that is already running. */
interface HostHandle {
  proc: UtilityProcess;
  /** Sessions routed to this host since it spawned — the crash blast radius. */
  liveSessions: Set<string>;
  /** dispose_session acks awaited by killSessionAgent, keyed by requestId. */
  pendingDisposes: Map<string, () => void>;
}

let current: HostHandle | null = null;
// Hosts we deliberately killed (restart / app quit), so their `exit` isn't
// reported as a crash. A set, not a flag: a killed host can still be awaiting
// its exit event while a fresh one is already running.
const intentionalKills = new Set<UtilityProcess>();

// Sessions with a generation in flight: marked on a prompt send (optimistic,
// like the renderer's running set) and on agent_start, cleared when the run
// ends. Lets recycleAgentsWhenIdle wait for a quiet moment — an intentional
// kill emits no agent-terminated, so killing mid-run would strand the chat
// visually "running" with its answer cut short. Module-level, not per-handle:
// it answers "is anything running right now", and every path that takes the
// host down clears it.
const runningSessions = new Set<string>();
// A recycle requested while a run was in flight; honored when the last ends.
let recyclePending = false;

// The relayed lines that can flip a session's run state. The substring guard
// keeps the hot relay path parse-free; a hit is confirmed on the parsed
// object, so a message merely containing the marker text changes nothing.
const RUN_MARKERS = ['"agent_start"', '"agent_end"', '"command":"prompt"'] as const;

function trackRunSignals(sessionPath: string, line: string): void {
  if (!RUN_MARKERS.some((marker) => line.includes(marker))) return;
  let event: { type?: unknown; willRetry?: unknown; command?: unknown; success?: unknown };
  try {
    event = JSON.parse(line) as typeof event;
  } catch {
    return;
  }
  if (event.type === "agent_start") {
    runningSessions.add(sessionPath);
    return;
  }
  // A retried run keeps going after its agent_end; a failed prompt preflight
  // means the optimistic mark from agent_send never became a run.
  const runEnded =
    (event.type === "agent_end" && event.willRetry !== true) ||
    (event.type === "response" && event.command === "prompt" && event.success === false);
  if (!runEnded) return;
  runningSessions.delete(sessionPath);
  finishPendingRecycle();
}

function finishPendingRecycle(): void {
  if (!recyclePending || runningSessions.size > 0) return;
  recyclePending = false;
  killAllAgents();
}

/** Reject session paths outside the sessions dir — the path becomes the host's
 *  session-file target. */
function assertSessionPath(sessionPath: unknown): string {
  if (typeof sessionPath !== "string" || sessionPath.length === 0) {
    throw new Error("session path is required");
  }
  const target = resolveSessionPath(sessionPath);
  if (!target) throw new Error("session path outside the sessions directory");
  return target;
}

/** Mint a fresh session file path (no host work — the first send does that). */
function createSessionPath(): string {
  mkdirSync(sessionsDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(sessionsDir(), `${stamp}_${randomUUID()}.jsonl`);
}

/** Resolve everything waiting on a (now gone) host so no caller hangs. */
function settleHostState(handle: HostHandle): void {
  handle.liveSessions.clear();
  for (const resolveAck of handle.pendingDisposes.values()) resolveAck();
  handle.pendingDisposes.clear();
}

function ensureHost(getWin: () => BrowserWindow | null): HostHandle {
  if (current) return current;
  const workspace = workspaceDir();
  // Every session's cwd; must exist at fork time. The app seeds it at launch
  // (workspace.ts) — this guards a workspace deleted while the app runs.
  mkdirSync(workspace, { recursive: true });

  // ForkOptions.env wants string values only.
  const env = Object.fromEntries(
    Object.entries(agentEnv()).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const proc = utilityProcess.fork(agentHostEntryPath(), [JSON.stringify(agentHostConfig(agentSkills()))], {
    cwd: workspace,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    serviceName: "accountant24-agent-host",
  });
  const handle: HostHandle = { proc, liveSessions: new Set(), pendingDisposes: new Map() };
  current = handle;
  console.log(`[agent] host spawned (pid ${proc.pid})`);

  const emit = (channel: string, payload: unknown) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  // stdout carries only console logs (the protocol runs over postMessage) —
  // surface them; keep a rolling stderr tail for crash diagnostics.
  proc.stdout?.setEncoding("utf8");
  proc.stdout?.on("data", (chunk: string) => {
    console.log(`[agent-host] ${chunk.trimEnd()}`);
  });
  let stderrTail = "";
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
  });

  proc.on("message", (message: AgentHostNotice) => {
    switch (message.kind) {
      case "event":
        trackRunSignals(message.sessionPath, message.line);
        emit("agent-event", { sessionPath: message.sessionPath, line: message.line });
        return;
      case "session_error":
        console.error(`[agent] session failed to start: ${message.message}`);
        trackAgentFailed("spawn");
        handle.liveSessions.delete(message.sessionPath);
        runningSessions.delete(message.sessionPath);
        emit("agent-error", { sessionPath: message.sessionPath, message: message.message });
        finishPendingRecycle();
        return;
      case "session_closed":
        handle.liveSessions.delete(message.sessionPath);
        runningSessions.delete(message.sessionPath);
        if (message.requestId !== undefined) {
          handle.pendingDisposes.get(message.requestId)?.();
          handle.pendingDisposes.delete(message.requestId);
        }
        finishPendingRecycle();
        return;
    }
  });

  proc.on("exit", (code) => {
    const wasCurrent = current === handle;
    if (wasCurrent) {
      current = null;
      // The crash took every run with it; a pending recycle is moot — the
      // next send re-forks with fresh skills anyway.
      runningSessions.clear();
      recyclePending = false;
    }
    const affected = [...handle.liveSessions];
    settleHostState(handle);
    // Kills we initiated (restart / app quit) aren't crashes — don't surface them.
    if (intentionalKills.delete(proc)) {
      console.log("[agent] host stopped (intentional)");
      return;
    }
    console.error(`[agent] host crashed: code=${code}`);
    if (stderrTail.trim()) console.error(`[agent] stderr tail:\n${stderrTail.trim()}`);
    trackAgentFailed("crash");
    // utilityProcess reports no signal; the renderer's crash copy handles null.
    for (const sessionPath of affected) {
      emit("agent-terminated", { sessionPath, code, signal: null, stderr: stderrTail.trim() });
    }
  });

  return handle;
}

/** Dispose one session in the host and wait for the ack (session delete). The
 *  ack guarantees the session file won't be re-persisted after the caller
 *  removes it; the timeout guarantees a delete never hangs on a wedged host. */
export async function killSessionAgent(sessionPath: string): Promise<void> {
  const target = resolve(sessionPath);
  const handle = current;
  if (!handle || !handle.liveSessions.has(target)) return;
  const requestId = randomUUID();
  const ack = new Promise<void>((resolveAck) => {
    handle.pendingDisposes.set(requestId, resolveAck);
  });
  handle.proc.postMessage({ kind: "dispose_session", sessionPath: target, requestId } satisfies AgentHostRequest);
  const timeout = new Promise<void>((resolveTimeout) => {
    setTimeout(resolveTimeout, DISPOSE_ACK_TIMEOUT_MS).unref();
  });
  await Promise.race([ack, timeout]);
  handle.pendingDisposes.delete(requestId);
}

/** Kill the host (app exit / restart after provider/skills changes). */
export function killAllAgents(): void {
  runningSessions.clear();
  recyclePending = false;
  const handle = current;
  if (!handle) return;
  intentionalKills.add(handle.proc);
  current = null;
  settleHostState(handle);
  handle.proc.kill();
}

/** Kill the host as soon as no run is in flight, so the next send re-forks
 *  with the current skill set: immediately when everything is idle, otherwise
 *  when the last running generation ends. Used by the plugins watcher — unlike
 *  agent_restart it may fire while the agent is mid-answer (writing a plugin
 *  is itself agent work), and that answer must finish. */
export function recycleAgentsWhenIdle(): void {
  if (runningSessions.size === 0) {
    killAllAgents();
    return;
  }
  recyclePending = true;
}

/** Register agent IPC. */
export function registerAgentIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle("agent_send", (_e, payload: unknown) => {
    const { sessionPath, command } = (payload ?? {}) as { sessionPath?: unknown; command?: unknown };
    const target = assertSessionPath(sessionPath);
    // Commands must be objects — anything else is a malformed protocol message.
    if (typeof command !== "object" || command === null) throw new Error("invalid agent command");
    const handle = ensureHost(getWin);
    handle.liveSessions.add(target);
    // Optimistic run mark (the renderer keeps the same one), closing the gap
    // between this send and its agent_start; a failed preflight unmarks it.
    if ((command as Record<string, unknown>).type === "prompt") runningSessions.add(target);
    handle.proc.postMessage({
      kind: "command",
      sessionPath: target,
      command: command as Record<string, unknown>,
    } satisfies AgentHostRequest);
  });
  ipcMain.handle("agent_create_session", () => createSessionPath());
  // Kill the host so the next send re-forks with fresh auth.json + models.json
  // + skills — the host caches all three at session creation. Re-fork is lazy
  // (each send carries its session path), so nothing to restart eagerly.
  ipcMain.handle("agent_restart", () => killAllAgents());
}
