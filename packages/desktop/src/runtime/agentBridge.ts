// Singleton dispatcher over the pi sidecar's RPC stream (JSON lines over Tauri IPC).
//
// - Owns the sidecar lifecycle (`agent_start`, once) and the ONE agent-event
//   subscription for the app's lifetime.
// - `request()` sends a command and resolves with its matching `response`.
// - `addEventListener()` fans out the live event stream (everything except
//   `response`) to subscribers — this is what the PiClient's `subscribe()` taps.
// - Auto-approves `extension_ui_request` (tool-permission prompts) so tools don't
//   hang. A real approval UI is a follow-up; until then host-UI requests are not
//   surfaced to the runtime.

import { agentApi } from "../rpc/api";
import type { AgentEvent } from "../rpc/types";

type EventListener = (e: AgentEvent) => void;
type ErrorListener = (message: string) => void;

class AgentBridge {
  private startPromise: Promise<void> | null = null;
  private readonly listeners = new Set<EventListener>();
  private readonly errorListeners = new Set<ErrorListener>();

  /** Spawn the sidecar + attach the single event subscription (idempotent). */
  ensureStarted(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = (async () => {
        await agentApi.start();
        await agentApi.onEvent((e) => this.handle(e));
        await agentApi.onTerminated(() => this.fail("The agent process stopped."));
        await agentApi.onError((m) => this.fail(m));
      })();
    }
    return this.startPromise;
  }

  private handle(e: AgentEvent): void {
    if (e.type === "extension_ui_request") {
      // Auto-approve so the agent never blocks on a permission prompt (v1).
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

  /** Send a command and resolve with the `response` payload for `commandName`. */
  async request<T>(command: object, commandName: string): Promise<T> {
    await this.ensureStarted();
    return new Promise<T>((resolve, reject) => {
      let unlisten: (() => void) | undefined;
      void agentApi
        .onEvent((e) => {
          if (e.type === "response" && e.command === commandName) {
            unlisten?.();
            if (e.success) resolve(e.data as T);
            else reject(new Error(e.error ?? `${commandName} failed`));
          }
        })
        .then((un) => {
          unlisten = un;
          void agentApi.send(command);
        });
    });
  }
}

export const agentBridge = new AgentBridge();
