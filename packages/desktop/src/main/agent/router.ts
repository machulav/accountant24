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
  // Every session's cwd; must exist at fork time (the extension scaffolds its
  // contents later, on session_start).
  mkdirSync(workspace, { recursive: true });

  // ForkOptions.env wants string values only.
  const env = Object.fromEntries(
    Object.entries(agentEnv()).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const proc = utilityProcess.fork(agentHostEntryPath(), [JSON.stringify(agentHostConfig())], {
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
        emit("agent-event", { sessionPath: message.sessionPath, line: message.line });
        return;
      case "session_error":
        console.error(`[agent] session failed to start: ${message.message}`);
        trackAgentFailed("spawn");
        handle.liveSessions.delete(message.sessionPath);
        emit("agent-error", { sessionPath: message.sessionPath, message: message.message });
        return;
      case "session_closed":
        handle.liveSessions.delete(message.sessionPath);
        if (message.requestId !== undefined) {
          handle.pendingDisposes.get(message.requestId)?.();
          handle.pendingDisposes.delete(message.requestId);
        }
        return;
    }
  });

  proc.on("exit", (code) => {
    if (current === handle) current = null;
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
  const handle = current;
  if (!handle) return;
  intentionalKills.add(handle.proc);
  current = null;
  settleHostState(handle);
  handle.proc.kill();
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
