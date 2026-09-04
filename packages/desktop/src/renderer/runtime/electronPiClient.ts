// A `PiClient` (from @assistant-ui/react-pi) implemented over the pi `--mode rpc`
// child process (spawned by the Electron main process, bridged via IPC) — so the
// official `usePiRuntime` drives all message projection / streaming / tool /
// thread-list rendering, while pi keeps running our `accountant24-extension.js`.
// This is the transport the package leaves open (HTTP/SSE is just one
// implementation); we mirror `client/httpClient.ts` against the sidecar.
//
// pi is single-active-session PER PROCESS; the runtime is multi-thread. We
// bridge that with one pi child per session (main spawns them on demand):
// `threadId` = pi session-file path = the routing key on every command and
// event, so a run keeps going — and keeps streaming — while the user views
// other threads. Every emitted event is stamped with a monotonic per-thread
// `seq` and a derived `turnIndex`, exactly as the node ThreadSupervisor does.

import type {
  PiClient,
  PiClientEvent,
  PiClientEventBody,
  PiHostUiResponse,
  PiModelInfo,
  PiQueuedMessage,
  PiRuntimeReadiness,
  PiSendMessageInput,
  PiThinkingLevel,
  PiThreadMetadata,
  PiThreadSnapshot,
  PiTranscriptMessage,
} from "@assistant-ui/react-pi";
import { piQueueItemId } from "@assistant-ui/react-pi";
import {
  trackAgentMessageSent,
  trackAgentToolUsed,
  trackChatCreated,
  trackSkillUsed,
  trackTransactionFirstAdded,
  trackUserFirstMessageSent,
  trackUserMessageSent,
} from "../lib/analyticsEvents";
import { extractAttachmentRefs } from "../lib/attachmentMarker";
import { parseModelId } from "../lib/enabledModels";
import { isMemoryUpdateCall } from "../lib/memory-tool";
import { mentionsToPlainText } from "../lib/mentions";
import { isOfficial } from "../lib/pluginRepo";
import { skillReadName } from "../lib/skill-docs-tool";
import { collapseSkillText, hoistSkillDirective } from "../lib/skillBlock";
import { agentApi, authApi, pluginsApi, sessionsApi, settingsApi } from "../rpc/api";
import type { AgentEvent, ModelInfo, SessionSummary } from "../rpc/types";
import { agentBridge } from "./agentBridge";
import { newChatModel } from "./newChatModel";
import { takePendingCompactionMarkers } from "./pendingCompaction";

/** Subset of the `get_state` response we read. */
type PiState = {
  model?: ModelInfo;
  thinkingLevel?: string;
  isStreaming?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  messageCount?: number;
  steeringMessages?: string[];
  followUpMessages?: string[];
};

/** Session events pi emits that our pinned assistant-ui runtime has no reducer
 *  for. It reads an unrecognized type as "my snapshot may be stale" and refetches
 *  the whole thread, so forwarding these would cost a full reload per event —
 *  several per run. Anything listed here is consumed before this point (the
 *  overflow interceptor uses `agent_settled`) or carries nothing we render. */
const UNRENDERED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "agent_settled",
  "entry_appended",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "bash_execution_update",
]);

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

const deriveReadiness = (model: ModelInfo | undefined): PiRuntimeReadiness =>
  model
    ? { state: "ready", selection: { provider: model.provider, modelId: model.id }, source: "session" }
    : { state: "missing-model", message: "No model selected. Configure a provider and pick a model." };

const toModelInfo = (m: ModelInfo): PiModelInfo => ({
  provider: m.provider,
  modelId: m.id,
  ...(m.name ? { name: m.name } : {}),
  supportsThinking: Boolean(m.reasoning),
});

export function createElectronPiClient(): PiClient {
  /** Each thread's model as `provider/modelId` — an analytics prop only.
   *  Kept from get_state snapshots and setModel; never sent back to pi. */
  const modelByThread = new Map<string, string>();
  const seqs = new Map<string, number>();
  const turns = new Map<string, number>();
  // Threads with a run in flight. Tracked here because a NEW thread's first
  // message is sent via createThread (not the controller), so without this the
  // runtime's load() snapshot would report idle and never connect() to the
  // stream — leaving the just-sent message and its reply invisible until a
  // manual refetch. Set on send, cleared on agent_end, keyed by the session
  // each event is tagged with — so background runs stay accurately "running".
  // A persistent listener keeps it accurate even between subscriptions.
  const running = new Set<string>();
  // skill_used analytics: resolve a skill to official-or-custom without leaking
  // custom identities. The lookup refreshes on the same signals as the composer
  // picker (every plugin mutation restarts the agent or fires plugins-event).
  // A use landing before the first fetch resolves reports "custom" —
  // acceptable for analytics.
  // Keyed by both names a use can arrive under — the `<plugin>:<skill>` name a
  // manual pick carries, and the bare folder name a SKILL.md read yields — each
  // mapping to the namespaced name the event reports.
  let officialSkills = new Map<string, string>();
  const refreshOfficialSkills = () => {
    pluginsApi
      .list()
      .then((r) => {
        // A bare name is only a safe key when one plugin ships it: a community
        // plugin with a folder of the same name would otherwise have its uses
        // counted as the official skill's.
        const bare = (name: string) => name.slice(name.indexOf(":") + 1);
        const shared = new Set<string>();
        const seen = new Set<string>();
        for (const skill of r.plugins.flatMap((p) => p.skills)) {
          const raw = bare(skill.name);
          if (seen.has(raw)) shared.add(raw);
          seen.add(raw);
        }
        officialSkills = new Map(
          r.plugins
            .filter(isOfficial)
            .flatMap((p) =>
              p.skills.flatMap((s) =>
                shared.has(bare(s.name))
                  ? [[s.name, s.name] as const]
                  : [[s.name, s.name] as const, [bare(s.name), s.name] as const],
              ),
            ),
        );
      })
      .catch(() => undefined);
  };
  refreshOfficialSkills();
  agentApi.onModelsChanged(refreshOfficialSkills);
  // Singleton client, never unmounted — the unsubscribe is deliberately dropped.
  void pluginsApi.onEvent((event) => {
    if (event.type === "changed") refreshOfficialSkills();
  });
  const trackSkillByName = (name: string, method: "manual" | "auto") => {
    const official = officialSkills.get(name);
    trackSkillUsed(official ?? "custom", official ? "official" : "custom", method);
  };
  // Memory updates ride on the generic edit/write tools (recognized by path in
  // the start event); end events carry no args, so the ids are correlated here
  // to keep the historical "update_memory" analytics name.
  const memoryToolCallIds = new Set<string>();
  agentBridge.addEventListener((e) => {
    // Tool + reply analytics live on this singleton listener (not mapEvent,
    // which runs once per active subscription) so each is counted exactly once.
    if (e.type === "tool_execution_start" && isMemoryUpdateCall(e.toolName, e.args)) {
      memoryToolCallIds.add(e.toolCallId);
    }
    if (e.type === "tool_execution_end") {
      const isMemoryUpdate = memoryToolCallIds.delete(e.toolCallId);
      trackAgentToolUsed(isMemoryUpdate ? "update_memory" : e.toolName, Boolean(e.isError));
      if (e.toolName === "add_transactions" && !e.isError) trackTransactionFirstAdded();
    }
    if (e.type === "tool_execution_start") {
      // The model activates a skill by reading its SKILL.md (pi's lazy-loading
      // contract) — that read IS the auto usage signal. The path is inspected
      // here only; it never leaves the machine.
      const skill = skillReadName(e.toolName, e.args);
      if (skill !== undefined) trackSkillByName(skill, "auto");
    }
    if (e.type === "agent_end") trackAgentMessageSent();
    if (e.type === "agent_start") running.add(e.sessionPath);
    else if (e.type === "agent_end") running.delete(e.sessionPath);
  });
  // A crashed child takes its in-flight run with it; other sessions' runs are
  // separate processes and keep going untouched.
  agentBridge.addErrorListener((sessionPath) => {
    running.delete(sessionPath);
  });

  const nextSeq = (threadId: string): number => {
    const n = (seqs.get(threadId) ?? 0) + 1;
    seqs.set(threadId, n);
    return n;
  };

  /** Collapse pi's expanded skill block in a transcript USER message back to
   *  the compact `:skill[name]` directive the composer sent. The round-trip
   *  must be text-identical: the runtime reconciles its optimistic copy of a
   *  sent message against the transcript by exact text, so pi's rewrite would
   *  otherwise leave a stray duplicate bubble. The collapsed form is also what
   *  the thread renders (skill chip + the user's words, not the instructions). */
  const collapseUserMessage = <T>(message: T): T => {
    const m = message as { role?: string; content?: unknown };
    if (m?.role !== "user" || !Array.isArray(m.content)) return message;
    let changed = false;
    const content = m.content.map((part) => {
      const p = part as { type?: string; text?: string };
      if (p?.type !== "text" || typeof p.text !== "string") return part;
      const collapsed = collapseSkillText(p.text);
      if (collapsed === p.text) return part;
      changed = true;
      return { ...p, text: collapsed };
    });
    return changed ? ({ ...m, content } as T) : message;
  };

  /** Pending steering/follow-up messages in the shape the runtime's queue
   *  adapter mirrors — same id scheme as react-pi's own ThreadSupervisor.
   *  Queued strings arrive post skill-expansion; collapse them like transcript
   *  user messages so the queue chip renders the `:skill[name]` directive. */
  const toQueuedMessages = (state: PiState): readonly PiQueuedMessage[] =>
    [
      ...(state.steeringMessages ?? []).map((content, i) => ({ mode: "steer" as const, content, i })),
      ...(state.followUpMessages ?? []).map((content, i) => ({ mode: "followUp" as const, content, i })),
    ].map(({ mode, content, i }) => ({ id: piQueueItemId(mode, i), mode, content: collapseSkillText(content) }));

  const buildSnapshot = (threadId: string, state: PiState, messages: unknown): PiThreadSnapshot => {
    if (state.model) modelByThread.set(threadId, `${state.model.provider}/${state.model.id}`);
    const list = Array.isArray(messages) ? messages.map(collapseUserMessage) : [];
    const queuedMessages = toQueuedMessages(state);
    return {
      metadata: {
        id: threadId,
        status: running.has(threadId) || state.isStreaming ? "running" : "idle",
        ...(state.sessionName ? { title: mentionsToPlainText(state.sessionName) } : {}),
        ...(state.sessionFile ? { sessionFile: state.sessionFile } : {}),
        ...(queuedMessages.length > 0 ? { queuedMessages } : {}),
        messageCount: state.messageCount ?? list.length,
        config: state.model
          ? { provider: state.model.provider, modelId: state.model.id, thinkingLevel: state.thinkingLevel }
          : { thinkingLevel: state.thinkingLevel },
      },
      messages: list as unknown as PiTranscriptMessage[],
      readiness: deriveReadiness(state.model),
    };
  };

  /** Map a sidecar `AgentEvent` to the wire `PiClientEventBody` (mirrors
   *  node/mapping.ts `mapSessionEvent`). Returns null to drop. */
  const mapEvent = (threadId: string, e: AgentEvent): PiClientEventBody | null => {
    if (UNRENDERED_EVENT_TYPES.has(e.type)) return null;
    // Most shapes pass through structurally: pi's wire data already matches the
    // mirror types; our local AgentEvent under-declares fields like
    // `partial`/`contentIndex`, but JSON.parse kept them at runtime, so the casts
    // forward the full payload the reducer needs.
    switch (e.type) {
      case "agent_start":
        return { type: "agent_start" };
      case "turn_start": {
        const t = (turns.get(threadId) ?? -1) + 1;
        turns.set(threadId, t);
        return { type: "turn_start", turnIndex: t };
      }
      case "turn_end":
        return { type: "turn_end", turnIndex: turns.get(threadId) ?? 0 };
      case "message_start":
        return { type: "message_start", message: collapseUserMessage(e.message) } as unknown as PiClientEventBody;
      case "message_update":
        return {
          type: "message_update",
          message: collapseUserMessage(e.message),
          assistantMessageEvent: e.assistantMessageEvent,
        } as unknown as PiClientEventBody;
      case "message_end":
        return { type: "message_end", message: collapseUserMessage(e.message) } as unknown as PiClientEventBody;
      case "tool_execution_start":
        return { type: "tool_execution_start", toolCallId: e.toolCallId, toolName: e.toolName, args: e.args };
      case "tool_execution_update":
        return {
          type: "tool_execution_update",
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          partialResult: undefined,
        };
      case "tool_execution_end":
        return { type: "tool_execution_end", toolCallId: e.toolCallId, result: e.result, isError: Boolean(e.isError) };
      case "queue_update":
        // Queued texts arrive post skill-expansion, like transcript user
        // messages — collapse them so the composer's queue chip renders the
        // `:skill[name]` directive instead of pi's expanded block.
        return {
          type: "queue_update",
          steering: e.steering.map(collapseSkillText),
          followUp: e.followUp.map(collapseSkillText),
        };
      default: {
        // Forward everything else with its full payload, as node/mapping.ts
        // does — the reducer needs e.g. `agent_end.willRetry` (keeps runStatus
        // running across recoveries), `compaction_start.reason`, and
        // `queue_update`'s arrays; unknown types are ignored downstream.
        const { sessionPath: _sessionPath, ...body } = e as { type: string; sessionPath?: string };
        return body as unknown as PiClientEventBody;
      }
    }
  };

  const client: PiClient = {
    async listThreads() {
      const res = await sessionsApi.list();
      return (res.sessions ?? []).map(
        (s: SessionSummary): PiThreadMetadata => ({
          id: s.path,
          status: "idle",
          // Unnamed sessions fall back to their first message, which for a
          // skill invocation is pi's expanded block — collapse it first.
          title: mentionsToPlainText(collapseSkillText(s.name || s.firstMessage || baseName(s.path))),
          sessionFile: s.path,
          messageCount: s.messageCount,
          updatedAt: s.modified,
        }),
      );
    },

    async createThread(input) {
      // Mint the session path up front (the first command spawns its child,
      // which starts a fresh session AT that path — see src/main/agent.ts),
      // fetching the default-model setting concurrently: two independent IPC
      // round-trips on the user-visible new-chat path.
      const [id, settings] = await Promise.all([agentApi.createSession(), settingsApi.get().catch(() => undefined)]);
      trackChatCreated();
      // Pick the model for the fresh session: the model the user chose in the
      // composer for this new chat, else the configured default. Sent before
      // get_state so the snapshot reflects it (stdin commands run in order).
      try {
        const chosen = newChatModel.get() ?? parseModelId(settings?.defaultModel ?? "");
        if (chosen) {
          await agentBridge.send(id, { type: "set_model", provider: chosen.provider, modelId: chosen.modelId });
        }
      } catch {
        // No model configured: keep pi's own default.
      } finally {
        // Reset so the next new chat starts from the default again.
        newChatModel.set(undefined);
      }
      const state = await agentBridge.request<PiState>(id, { type: "get_state" }, "get_state");
      turns.delete(id);
      // Record the new chat's model before the initial message is tracked —
      // buildSnapshot below runs too late, and would leave user_message_sent
      // stamped with no model.
      if (state.model) modelByThread.set(id, `${state.model.provider}/${state.model.id}`);
      if (input?.initialMessage) await client.sendMessage(id, input.initialMessage);
      return buildSnapshot(id, state, []);
    },

    async getThread(threadId) {
      const [msgs, state] = await Promise.all([
        agentBridge.request<{ messages: unknown }>(threadId, { type: "get_messages" }, "get_messages"),
        agentBridge.request<PiState>(threadId, { type: "get_state" }, "get_state"),
      ]);
      // Every snapshot flows through here (ThreadController.load() calls this
      // directly; subscribe()'s snapshot branch does too). The fetched
      // transcript already carries pi's persisted compactionSummary entries,
      // so any marker still parked for a later injection would now duplicate
      // the one in the snapshot.
      takePendingCompactionMarkers(threadId);
      return buildSnapshot(threadId, state, msgs.messages);
    },

    async sendMessage(threadId, input: PiSendMessageInput) {
      // `input.attachments` carries images only; documents (PDF, CSV, …) travel
      // as marker lines inside `content` — count both as attachments.
      const hasAttachment = Boolean(input.attachments?.length) || extractAttachmentRefs(input.content).refs.length > 0;
      trackUserMessageSent(hasAttachment, modelByThread.get(threadId));
      trackUserFirstMessageSent();
      // A picked skill rides in the composer as a `:skill[name]` chip; pi
      // expects a leading `/skill:name` token instead — rewrite on the way out.
      const message = hoistSkillDirective(input.content);
      const skillToken = /^\/skill:(\S+)/.exec(message)?.[1];
      if (skillToken) trackSkillByName(skillToken, "manual");
      running.add(threadId); // optimistic — flips status to running before agent_start arrives; a mid-run send is a no-op here
      // An id-tracked request, not fire-and-forget: pi's preflight rejection
      // (e.g. a mid-run send during compaction) must reject this promise so
      // the runtime rolls back its optimistic message/queue entry.
      await agentBridge.request<void>(
        threadId,
        {
          type: "prompt",
          message,
          ...(input.attachments?.length ? { images: input.attachments } : {}),
          ...(input.streamingBehavior ? { streamingBehavior: input.streamingBehavior } : {}),
        },
        "prompt",
      );
    },

    async cancelRun(threadId) {
      await agentBridge.send(threadId, { type: "abort" });
    },

    async clearQueue(threadId) {
      // pi's abort keeps queued messages; clearing is its own command. The
      // cleared texts go back to the composer, so collapse them like any
      // transcript user message.
      const cleared = await agentBridge.request<{ steering?: string[]; followUp?: string[] }>(
        threadId,
        { type: "clear_queue" },
        "clear_queue",
      );
      return {
        steering: (cleared.steering ?? []).map(collapseSkillText),
        followUp: (cleared.followUp ?? []).map(collapseSkillText),
      };
    },

    async getAvailableModels() {
      // Session-independent: read the catalog straight from main's in-process
      // ModelRegistry (re-reads auth.json/models.json per call) instead of
      // asking some child — no child needs to exist for the picker to work.
      const data = await authApi.models();
      return (data.models ?? []).map(toModelInfo);
    },

    async setModel(threadId, input) {
      modelByThread.set(threadId, `${input.provider}/${input.modelId}`);
      await agentBridge.send(threadId, { type: "set_model", provider: input.provider, modelId: input.modelId });
    },

    async setThinkingLevel(threadId, level: PiThinkingLevel) {
      await agentBridge.send(threadId, { type: "set_thinking_level", level });
    },

    async renameThread(threadId, title) {
      await agentBridge.send(threadId, { type: "set_session_name", name: title });
    },

    async archiveThread() {
      // pi has no archive concept; no-op.
    },
    async unarchiveThread() {
      // no-op
    },

    async deleteThread(threadId) {
      await sessionsApi.delete(threadId);
    },

    async respondToHostUiRequest(threadId, response: PiHostUiResponse) {
      // Auto-approval in agentBridge means the runtime normally never calls this;
      // honor it anyway for completeness.
      if ("confirmed" in response) {
        await agentBridge.send(threadId, {
          type: "extension_ui_response",
          id: response.requestId,
          confirmed: response.confirmed,
        });
      } else if ("value" in response) {
        await agentBridge.send(threadId, {
          type: "extension_ui_response",
          id: response.requestId,
          value: response.value,
          confirmed: true,
        });
      } else {
        await agentBridge.send(threadId, { type: "extension_ui_response", id: response.requestId, confirmed: false });
      }
    },

    subscribe(threadId, listener: (event: PiClientEvent) => void, options) {
      const includeSnapshot = options?.includeSnapshot !== false;
      let active = true;
      const offs: Array<() => void> = [];
      const emit = (body: PiClientEventBody) => {
        if (!active) return;
        listener({ ...body, threadId, seq: nextSeq(threadId) } as PiClientEvent);
      };
      // Re-sync this subscription with the session's live compaction state:
      // react-pi keeps thread state in a cached controller that unsubscribes
      // ~30s after unmount, and snapshots don't carry compaction — so without
      // this a compaction that started (or ended) while unsubscribed would be
      // missed (or stick forever). Runs after attachLive() so nothing races.
      const emitCompactionHeal = () => {
        const c = agentBridge.compactionState(threadId);
        if (!c?.everCompacted) return;
        emit(
          c.active
            ? { type: "compaction_start", reason: c.reason ?? "threshold" }
            : { type: "compaction_end", aborted: false, willRetry: false },
        );
      };
      const attachLive = () => {
        if (!active) return;
        offs.push(
          agentBridge.addEventListener((e) => {
            // The bridge broadcasts every session's stream; only this thread's
            // child's events belong here (concurrent runs stream in parallel).
            if (e.sessionPath !== threadId) return;
            const body = mapEvent(threadId, e);
            if (body) emit(body);
          }),
        );
        offs.push(
          agentBridge.addErrorListener((sessionPath, msg) => {
            if (sessionPath === threadId) emit({ type: "error", error: msg });
          }),
        );
      };

      if (includeSnapshot) {
        // Snapshot first (seq 1), then live events (seq 2+).
        client
          .getThread(threadId)
          .then((snapshot) => {
            emit({ type: "snapshot", snapshot });
            attachLive();
            emitCompactionHeal();
          })
          .catch((err) => {
            emit({ type: "error", error: err instanceof Error ? err.message : String(err) });
            attachLive();
          });
      } else {
        attachLive();
        emitCompactionHeal();
      }

      return () => {
        active = false;
        for (const off of offs) off();
      };
    },
  };

  return client;
}
