// Singleton dispatcher over the pi sidecar's RPC stream (JSON lines over Tauri IPC).
//
// - Owns the sidecar lifecycle (`agent_start`, once) and the ONE agent-event
//   subscription for the app's lifetime.
// - `request()` sends a command and resolves with its matching `response`.
// - `addEventListener()` fans out the live event stream (everything except
//   `response`) to subscribers — this is what the PiClient's `subscribe()` taps.
// - Auto-confirms `extension_ui_request` so the agent can never hang on a
//   blocking host-UI call. NOTE this is a defensive guard, not a permission
//   bypass: pi's RPC mode has no tool-permission prompts (only the interactive
//   TUI does), and neither pi core nor our extension emits blocking
//   confirm/input requests today. If a real approval flow is ever needed,
//   surface these to the UI instead of confirming here.

import { type AgentExit, agentApi } from "../rpc/api";
import type { AgentEvent } from "../rpc/types";

type EventListener = (e: AgentEvent) => void;
type ErrorListener = (message: string) => void;

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

class AgentBridge {
  private startPromise: Promise<void> | null = null;
  private wired = false;
  private readonly listeners = new Set<EventListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  // Reject callbacks for in-flight request() promises, so a sidecar crash can
  // fail them instead of leaving their callers hanging forever.
  private readonly pendingRequests = new Set<(error: Error) => void>();

  /** Spawn the sidecar (idempotent). The process-lifetime subscriptions are
   *  attached once via wire(); a crash clears `startPromise` so the next
   *  send()/request() respawns the agent instead of leaving the session dead. */
  ensureStarted(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = (async () => {
        await this.wire();
        await agentApi.start();
      })();
    }
    return this.startPromise;
  }

  /** Attach the event/terminate/error subscriptions exactly once — they listen
   *  on the IPC channel, not a specific child, so they survive respawns. */
  private async wire(): Promise<void> {
    if (this.wired) return;
    this.wired = true;
    await agentApi.onEvent((e) => this.handle(e));
    await agentApi.onTerminated((info) => this.onStopped(describeExit(info)));
    await agentApi.onError((m) => this.onStopped(m));
  }

  /** Reset the start latch (so the next call respawns), reject any in-flight
   *  requests, and notify subscribers. */
  private onStopped(message: string): void {
    this.startPromise = null;
    const error = new Error(message);
    for (const reject of [...this.pendingRequests]) reject(error);
    this.fail(message);
  }

  private handle(e: AgentEvent): void {
    if (e.type === "extension_ui_request") {
      // Confirm so the agent can never block on a host-UI call (see header note).
      const response: Record<string, unknown> = { type: "extension_ui_response", id: e.id, confirmed: true };
      if (e.method === "input") response.value = "";
      agentApi.send(response).catch(() => undefined);
      return;
    }
    // `response` events are consumed by request()'s own listener; everything
    // else is live stream output for subscribers.
    if (e.type === "response") return;
    for (const fn of [...this.listeners]) fn(e);
  }

  private fail(message: string): void {
    for (const fn of [...this.errorListeners]) fn(message);
  }

  /** Subscribe to the live event stream. Returns an unsubscribe function. */
  addEventListener(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Subscribe to sidecar process errors/termination. Returns an unsubscribe. */
  addErrorListener(fn: ErrorListener): () => void {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  /** Send a raw RPC command (ensures the sidecar is up first). */
  async send(command: object): Promise<void> {
    await this.ensureStarted();
    await agentApi.send(command);
  }

  /** Send a command and resolve with its `response` payload. Each request gets
   *  a unique `id` that pi echoes back, so overlapping requests — even for the
   *  same command — each receive their own response. Rejects if the sidecar
   *  stops (via onStopped) or the request times out, so the caller never hangs;
   *  the per-request event listener is always removed. */
  async request<T>(command: object, commandName: string): Promise<T> {
    await this.ensureStarted();
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      let unlisten: (() => void) | undefined;
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;

      const cleanup = () => {
        clearTimeout(timer);
        this.pendingRequests.delete(fail);
        unlisten?.();
      };
      const succeed = (data: T) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(data);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      timer = setTimeout(() => fail(new Error(`${commandName} timed out`)), REQUEST_TIMEOUT_MS);
      // Registered so onStopped() can reject this request on a sidecar crash.
      this.pendingRequests.add(fail);

      void agentApi
        .onEvent((e) => {
          if (e.type === "response" && e.id === requestId) {
            if (e.success) succeed(e.data as T);
            else fail(new Error(e.error ?? `${commandName} failed`));
          }
        })
        .then((un) => {
          unlisten = un;
          // If we already settled (timeout/crash) before the listener resolved,
          // drop it immediately; otherwise it's live and we can send.
          if (settled) un();
          else void agentApi.send({ ...command, id: requestId });
        });
    });
  }
}

export const agentBridge = new AgentBridge();
