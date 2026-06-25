// Singleton bridge between the pi sidecar (callback-based agent-event stream over
// RPC) and assistant-ui's per-turn async-generator adapters.
//
// - Owns the sidecar lifecycle (`agent_start`, once) and the ONE agent-event
//   subscription for the app's lifetime.
// - `runPrompt()` turns the callback stream into an async iterator scoped to a
//   single `agent_start … agent_end` cycle (the sidecar is single-threaded, so
//   one run owns the stream at a time).
// - Auto-approves `extension_ui_request` (tool-permission prompts) in v1 so tools
//   don't hang — this is a local single-user personal agent; a real permission
//   UI is a follow-up.

import { agentApi } from "../rpc/api";
import type { AgentEvent } from "../rpc/types";

type ActiveRun = {
  push: (e: AgentEvent) => void;
  fail: (err: Error) => void;
};

class AgentBridge {
  private startPromise: Promise<void> | null = null;
  private active: ActiveRun | null = null;

  /** Spawn the sidecar + attach the single event subscription (idempotent). */
  ensureStarted(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = (async () => {
        await agentApi.start();
        await agentApi.onEvent((e) => this.handle(e));
        await agentApi.onTerminated(() => this.active?.fail(new Error("The agent process stopped.")));
        await agentApi.onError((m) => this.active?.fail(new Error(m)));
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
    this.active?.push(e);
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

  /** Drive one prompt; yields its events until `agent_end`. Throws if the sidecar dies. */
  async *runPrompt(message: string, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    await this.ensureStarted();

    const queue: AgentEvent[] = [];
    let wake: ((r: IteratorResult<AgentEvent>) => void) | null = null;
    let failure: Error | null = null;

    this.active = {
      push: (e) => {
        if (wake) {
          const w = wake;
          wake = null;
          w({ value: e, done: false });
        } else {
          queue.push(e);
        }
      },
      fail: (err) => {
        failure = err;
        if (wake) {
          const w = wake;
          wake = null;
          w({ value: undefined as never, done: true });
        }
      },
    };

    const onAbort = () => {
      agentApi.send({ type: "abort" }).catch(() => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      await agentApi.send({ type: "prompt", message });
      while (true) {
        if (failure) throw failure;
        const queued = queue.shift();
        const next = queued ?? (await new Promise<IteratorResult<AgentEvent>>((r) => (wake = r))).value;
        if (failure) throw failure;
        if (!next) return;
        yield next;
        if (next.type === "agent_end") return;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.active = null;
    }
  }
}

export const agentBridge = new AgentBridge();
