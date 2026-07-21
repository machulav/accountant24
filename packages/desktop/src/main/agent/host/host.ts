// AgentHost — the core of the agent-host utilityProcess: one pi session
// runtime per chat, commands dispatched exactly like pi's own RPC mode
// (dist/modes/rpc/rpc-mode.js is the byte-compat reference), events serialized
// to the same JSON lines the RPC child used to write to stdout.
//
// This module runs in the utilityProcess and must not import Electron APIs.
// It is also SDK-free: the pi runtime is injected via RuntimeFactory so tests
// drive it with fakes (the real factory lives in ./runtime.ts).

import type { AgentHostNotice, AgentHostRequest } from "../../../shared/agentHost";

/** The slice of pi's AgentSession the host dispatches on. */
export interface HostSession {
  prompt(
    text: string,
    options?: {
      images?: unknown;
      streamingBehavior?: unknown;
      source?: string;
      preflightResult?: (success: boolean) => void;
    },
  ): Promise<void>;
  abort(): Promise<void>;
  setModel(model: unknown): Promise<void>;
  setThinkingLevel(level: never): void;
  setSessionName(name: string): void;
  subscribe(listener: (event: object) => void): () => void;
  readonly modelRegistry: {
    getAvailable(): Array<{ provider: string; id: string }> | Promise<Array<{ provider: string; id: string }>>;
  };
  readonly model: unknown;
  readonly thinkingLevel: unknown;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly steeringMode: unknown;
  readonly followUpMode: unknown;
  readonly sessionFile: unknown;
  readonly sessionId: unknown;
  readonly sessionName: unknown;
  readonly autoCompactionEnabled: boolean;
  readonly messages: unknown[];
  readonly pendingMessageCount: number;
}

/** The slice of pi's AgentSessionRuntime the host manages. */
export interface HostRuntime {
  readonly session: HostSession;
  dispose(): Promise<void>;
}

/** Bridge handed to the runtime factory so extension UI dialogs flow through
 *  the same event stream as everything else (as extension_ui_request lines). */
export interface UiBridge {
  emit(event: Record<string, unknown>): void;
  readonly pending: Map<string, { resolve(response: Record<string, unknown>): void; reject(err: Error): void }>;
}

export type RuntimeFactory = (sessionPath: string, ui: UiBridge) => Promise<HostRuntime>;

// Same operational constants as the old per-child manager in agent.ts.
/** Dispose idle sessions after this long without commands or events. */
export const IDLE_TTL_MS = 15 * 60_000;
/** Soft cap on resident sessions; above it, creating evicts the LRU idle one. */
export const MAX_SESSIONS = 8;
export const REAP_INTERVAL_MS = 60_000;

interface SessionEntry {
  runtime: Promise<HostRuntime>;
  /** Resolved session, once the runtime is up — used for isStreaming checks. */
  session?: HostSession;
  /** Per-session serial queue: commands run strictly in arrival order (the
   *  guarantee the renderer relies on, e.g. set_model before get_state). */
  queue: Promise<unknown>;
  lastActivity: number;
  ui: UiBridge;
  unsubscribe?: () => void;
}

interface AgentHostDeps {
  createRuntime: RuntimeFactory;
  post: (notice: AgentHostNotice) => void;
  /** Injectable clock for reaper tests. */
  now?: () => number;
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class AgentHost {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly deps: AgentHostDeps;
  private readonly now: () => number;

  constructor(deps: AgentHostDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  handleMessage(msg: AgentHostRequest): void {
    if (msg.kind === "dispose_session") {
      void this.disposeSession(msg.sessionPath, "disposed", msg.requestId);
      return;
    }
    const { sessionPath, command } = msg;
    // Extension UI responses resolve a pending dialog directly — never queued,
    // exactly like RPC mode handles them ahead of the command switch.
    if (command.type === "extension_ui_response") {
      const pending = this.sessions.get(sessionPath)?.ui.pending.get(String(command.id));
      if (pending) {
        this.sessions.get(sessionPath)?.ui.pending.delete(String(command.id));
        pending.resolve(command);
      }
      return;
    }
    const entry = this.ensureEntry(sessionPath);
    entry.lastActivity = this.now();
    entry.queue = entry.queue.then(() => this.handleCommand(sessionPath, entry, command));
  }

  startReaper(): void {
    setInterval(() => this.reapIdle(), REAP_INTERVAL_MS).unref();
  }

  /** Dispose every session (host shutdown). */
  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((path) => this.disposeSession(path, "disposed")));
  }

  // ---- session lifecycle -----------------------------------------------------

  private ensureEntry(sessionPath: string): SessionEntry {
    const existing = this.sessions.get(sessionPath);
    if (existing) return existing;

    this.evictForCap();
    const ui: UiBridge = {
      emit: (event) => this.postEvent(sessionPath, event),
      pending: new Map(),
    };
    const entry: SessionEntry = {
      runtime: undefined as never,
      queue: Promise.resolve(),
      lastActivity: this.now(),
      ui,
    };
    entry.runtime = this.deps.createRuntime(sessionPath, ui).then((runtime) => {
      entry.session = runtime.session;
      entry.unsubscribe = runtime.session.subscribe((event) => {
        entry.lastActivity = this.now();
        this.postEvent(sessionPath, event as Record<string, unknown>);
      });
      return runtime;
    });
    // A failed creation clears the slot (the next command retries from scratch)
    // and surfaces one session_error; queued commands with ids also get their
    // own error responses from handleCommand's catch.
    entry.runtime.catch((e: unknown) => {
      if (this.sessions.get(sessionPath) === entry) this.sessions.delete(sessionPath);
      this.deps.post({ kind: "session_error", sessionPath, message: errorMessage(e) });
    });
    this.sessions.set(sessionPath, entry);
    return entry;
  }

  /** Dispose idle sessions past the TTL. Never touches a streaming session. */
  private reapIdle(): void {
    const now = this.now();
    for (const [sessionPath, entry] of this.sessions) {
      if (entry.session && !entry.session.isStreaming && now - entry.lastActivity > IDLE_TTL_MS) {
        console.log(`[agent-host] reaping idle session ${sessionPath}`);
        void this.disposeSession(sessionPath, "reaped");
      }
    }
  }

  /** Above the cap, evict the least-recently-active idle session to make room.
   *  A session still being created or with a run in flight is never evicted. */
  private evictForCap(): void {
    while (this.sessions.size >= MAX_SESSIONS) {
      let lru: [string, SessionEntry] | undefined;
      for (const candidate of this.sessions) {
        if (!candidate[1].session || candidate[1].session.isStreaming) continue;
        if (!lru || candidate[1].lastActivity < lru[1].lastActivity) lru = candidate;
      }
      if (!lru) return; // everything is running/creating — go over the cap
      console.log(`[agent-host] evicting idle session ${lru[0]}`);
      void this.disposeSession(lru[0], "evicted");
    }
  }

  private async disposeSession(
    sessionPath: string,
    reason: "reaped" | "evicted" | "disposed",
    requestId?: string,
  ): Promise<void> {
    const close: AgentHostNotice = {
      kind: "session_closed",
      sessionPath,
      reason,
      ...(requestId !== undefined ? { requestId } : {}),
    };
    const entry = this.sessions.get(sessionPath);
    if (!entry) {
      // Nothing to tear down — still ack, so a delete of a never-started
      // session doesn't wait for the timeout.
      this.deps.post(close);
      return;
    }
    this.sessions.delete(sessionPath);
    entry.unsubscribe?.();
    try {
      const runtime = await entry.runtime;
      // Deleting a running chat intentionally aborts its run before teardown.
      await runtime.session.abort();
      await runtime.dispose();
    } catch {
      // creation failed or teardown failed — the slot is gone either way
    }
    this.deps.post(close);
  }

  // ---- command dispatch (port of rpc-mode's handleCommand) -------------------

  private postEvent(sessionPath: string, event: Record<string, unknown>): void {
    this.deps.post({ kind: "event", sessionPath, line: JSON.stringify(event) });
  }

  private async handleCommand(
    sessionPath: string,
    entry: SessionEntry,
    command: Record<string, unknown>,
  ): Promise<void> {
    const id = command.id;
    const type = typeof command.type === "string" ? command.type : String(command.type);
    const success = (data?: unknown): Record<string, unknown> =>
      data === undefined
        ? { id, type: "response", command: type, success: true }
        : { id, type: "response", command: type, success: true, data };
    const error = (message: string): Record<string, unknown> => ({
      id,
      type: "response",
      command: type,
      success: false,
      error: message,
    });

    try {
      const runtime = await entry.runtime;
      const session = runtime.session;
      switch (type) {
        case "prompt": {
          // Fire-and-forget like RPC mode: the authoritative response is
          // emitted only after prompt preflight succeeds.
          let preflightSucceeded = false;
          void session
            .prompt(String(command.message ?? ""), {
              images: command.images,
              streamingBehavior: command.streamingBehavior,
              source: "rpc",
              preflightResult: (didSucceed) => {
                if (didSucceed) {
                  preflightSucceeded = true;
                  this.postEvent(sessionPath, success());
                }
              },
            })
            .catch((e: unknown) => {
              if (!preflightSucceeded) this.postEvent(sessionPath, error(errorMessage(e)));
            });
          return;
        }
        case "abort": {
          await session.abort();
          this.postEvent(sessionPath, success());
          return;
        }
        case "set_model": {
          const models = await session.modelRegistry.getAvailable();
          const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
          if (!model) {
            this.postEvent(sessionPath, error(`Model not found: ${command.provider}/${command.modelId}`));
            return;
          }
          await session.setModel(model);
          this.postEvent(sessionPath, success(model));
          return;
        }
        case "set_thinking_level": {
          session.setThinkingLevel(command.level as never);
          this.postEvent(sessionPath, success());
          return;
        }
        case "set_session_name": {
          const name = String(command.name ?? "").trim();
          if (!name) {
            this.postEvent(sessionPath, error("Session name cannot be empty"));
            return;
          }
          session.setSessionName(name);
          this.postEvent(sessionPath, success());
          return;
        }
        case "get_state": {
          this.postEvent(
            sessionPath,
            success({
              model: session.model,
              thinkingLevel: session.thinkingLevel,
              isStreaming: session.isStreaming,
              isCompacting: session.isCompacting,
              steeringMode: session.steeringMode,
              followUpMode: session.followUpMode,
              sessionFile: session.sessionFile,
              sessionId: session.sessionId,
              sessionName: session.sessionName,
              autoCompactionEnabled: session.autoCompactionEnabled,
              messageCount: session.messages.length,
              pendingMessageCount: session.pendingMessageCount,
            }),
          );
          return;
        }
        case "get_messages": {
          this.postEvent(sessionPath, success({ messages: session.messages }));
          return;
        }
        default: {
          this.postEvent(sessionPath, error(`Unknown command: ${type}`));
          return;
        }
      }
    } catch (e) {
      this.postEvent(sessionPath, error(errorMessage(e)));
    }
  }
}
