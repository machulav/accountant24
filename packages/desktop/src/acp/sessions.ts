// One pi runtime per ACP session, plus the per-session cancel flag.
//
// The ACP sessionId IS the pi session-file path: it is opaque to the client by
// spec, and using the real path means a chat started over ACP lands in
// ~/Accountant24/sessions like any other and shows up in the app's chat list.

import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { UiBridge } from "../main/agent/host/host";

export interface AcpSession {
  readonly id: string;
  readonly runtime: AgentSessionRuntime;
  /** Set by session/cancel so the in-flight prompt resolves as "cancelled". */
  cancelled: boolean;
  dispose(): Promise<void>;
}

/**
 * The UI bridge handed to the pi runtime.
 *
 * pi's extension UI (confirm/input/select dialogs) has no ACP equivalent, and a
 * blocking dialog with nobody to answer it would hang the turn. We auto-answer
 * exactly as the desktop renderer does. This is a liveness guard, not a
 * permission bypass: pi has no tool-permission prompts outside its interactive
 * TUI, and neither pi core nor the accountant24 extension raises one today. If
 * real approvals are ever added, they should become session/request_permission
 * here rather than being answered blind.
 */
export function autoAnsweringUi(): UiBridge {
  const pending: UiBridge["pending"] = new Map();
  return {
    pending,
    emit(event) {
      const id = typeof event.id === "string" ? event.id : undefined;
      if (!id) return;
      const waiter = pending.get(id);
      // Display-only calls (notify/setStatus/setTitle/…) emit without ever
      // registering a waiter; only real dialogs need an answer.
      if (!waiter) return;
      pending.delete(id);
      waiter.resolve(event.method === "input" ? { confirmed: true, value: "" } : { confirmed: true });
    },
  };
}

export class SessionStore {
  private readonly sessions = new Map<string, AcpSession>();

  async open(
    id: string,
    createRuntime: (sessionPath: string, ui: UiBridge) => Promise<AgentSessionRuntime>,
    onEvent: (event: object) => void,
  ): Promise<AcpSession> {
    const runtime = await createRuntime(id, autoAnsweringUi());
    const unsubscribe = runtime.session.subscribe(onEvent);
    const session: AcpSession = {
      id,
      runtime,
      cancelled: false,
      dispose: async () => {
        this.sessions.delete(id);
        unsubscribe();
        try {
          await runtime.session.abort();
          await runtime.dispose();
        } catch {
          // Teardown is best-effort; the slot is gone either way.
        }
      },
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): AcpSession | undefined {
    return this.sessions.get(id);
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.dispose()));
  }
}
