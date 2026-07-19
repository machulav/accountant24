// Singleton dispatcher over the pi sidecars' RPC streams (JSON lines over
// Electron IPC, one pi child per session — main spawns them on demand).
//
// - Owns the ONE agent-event subscription for the app's lifetime; every event
//   arrives tagged with its originating `sessionPath`.
// - `request()` sends a command to one session's child and resolves with its
//   matching `response`.
// - `addEventListener()` fans out the live event stream (everything except
//   `response`) to subscribers — this is what the PiClient's `subscribe()` taps.
// - Auto-confirms `extension_ui_request` so the agent can never hang on a
//   blocking host-UI call. NOTE this is a defensive guard, not a permission
//   bypass: pi's RPC mode has no tool-permission prompts (only the interactive
//   TUI does), and neither pi core nor our extension emits blocking
//   confirm/input requests today. If a real approval flow is ever needed,
//   surface these to the UI instead of confirming here.

import { type AgentExit, agentApi } from "../rpc/api";
import type { SessionAgentEvent } from "../rpc/types";

type EventListener = (e: SessionAgentEvent) => void;
type ErrorListener = (sessionPath: string, message: string) => void;

/** How long an unanswered `request()` waits before rejecting. Guards against a
 *  sidecar that dies without emitting a terminate/error event, or a lost
 *  response — without it the caller's promise would hang forever. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Human-readable crash message + a short stderr tail, and a hint that sending a
 *  message respawns the agent. */
function describeExit(info: AgentExit): string {
  const how = info.signal ? ` (${info.signal})` : info.code != null ? ` (exit ${info.code})` : "";
  const tail = info.stderr ? `\n\n${info.stderr.split("\n").slice(-8).join("\n")}` : "";
  return `The agent stopped${how}. Send a message to restart it.${tail}`;
}

interface PendingRequest {
  /** Which child answers this request — a crash fails only its own session's. */
  sessionPath: string;
  commandName: string;
  succeed: (data: unknown) => void;
  fail: (error: Error) => void;
}

class AgentBridge {
  private wirePromise: Promise<void> | null = null;
  private readonly listeners = new Set<EventListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  /** In-flight request() promises keyed by their correlation id. */
  private readonly pending = new Map<string, PendingRequest>();

  /** Attach the event/terminate/error subscriptions exactly once — they listen
   *  on the IPC channel, not a specific child, so they survive respawns. */
  private wire(): Promise<void> {
    if (!this.wirePromise) {
      this.wirePromise = (async () => {
        await agentApi.onEvent((e) => this.handle(e));
        await agentApi.onTerminated((info) => this.onStopped(info.sessionPath, describeExit(info)));
        await agentApi.onError((info) => this.onStopped(info.sessionPath, info.message));
      })();
    }
    return this.wirePromise;
  }

  /** Reject the crashed session's in-flight requests and notify subscribers.
   *  Other sessions' children are untouched; the next send to this session
   *  respawns its child. */
  private onStopped(sessionPath: string, message: string): void {
    const error = new Error(message);
    for (const p of [...this.pending.values()]) if (p.sessionPath === sessionPath) p.fail(error);
    for (const fn of [...this.errorListeners]) fn(sessionPath, message);
  }

  private handle(e: SessionAgentEvent): void {
    if (e.type === "response") {
      // Settled here, in the one wired listener, so an in-flight request adds
      // no extra IPC listener (each would re-parse every session's stream).
      const p = e.id ? this.pending.get(e.id) : undefined;
      if (p) {
        if (e.success) p.succeed(e.data);
        else p.fail(new Error(e.error ?? `${p.commandName} failed`));
      }
      return;
    }
    if (e.type === "extension_ui_request") {
      // Confirm so the agent can never block on a host-UI call (see header
      // note) — replying to the child the request came from.
      const response: Record<string, unknown> = { type: "extension_ui_response", id: e.id, confirmed: true };
      if (e.method === "input") response.value = "";
      agentApi.send(e.sessionPath, response).catch(() => undefined);
      return;
    }
    for (const fn of [...this.listeners]) fn(e);
  }

  /** Subscribe to the live event stream (all sessions — filter by
   *  `e.sessionPath`). Returns an unsubscribe function. */
  addEventListener(fn: EventListener): () => void {
    void this.wire();
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Subscribe to sidecar process errors/termination. Returns an unsubscribe. */
  addErrorListener(fn: ErrorListener): () => void {
    void this.wire();
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  /** Send a raw RPC command to one session's child (main spawns it on demand). */
  async send(sessionPath: string, command: object): Promise<void> {
    await this.wire();
    await agentApi.send(sessionPath, command);
  }

  /** Send a command to one session's child and resolve with its `response`
   *  payload. Each request gets a unique `id` that pi echoes back, so
   *  overlapping requests — even for the same command, even across different
   *  children — each receive their own response (matched in handle()).
   *  Rejects if THAT session's child stops (via onStopped), the send fails,
   *  or the request times out, so the caller never hangs. */
  async request<T>(sessionPath: string, command: object, commandName: string): Promise<T> {
    await this.wire();
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => fail(new Error(`${commandName} timed out`)), REQUEST_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        this.pending.delete(requestId);
      };
      const succeed = (data: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(data as T);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      this.pending.set(requestId, { sessionPath, commandName, succeed, fail });
      agentApi.send(sessionPath, { ...command, id: requestId }).catch(fail);
    });
  }
}

export const agentBridge = new AgentBridge();
