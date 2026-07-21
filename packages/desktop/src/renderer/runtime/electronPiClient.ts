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
  PiRuntimeReadiness,
  PiSendMessageInput,
  PiThinkingLevel,
  PiThreadMetadata,
  PiThreadSnapshot,
  PiTranscriptMessage,
} from "@assistant-ui/react-pi";
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
import { mentionsToPlainText } from "../lib/mentions";
import { collapseSkillText, hoistSkillDirective } from "../lib/skillBlock";
import { agentApi, authApi, sessionsApi, settingsApi, skillsApi } from "../rpc/api";
import type { AgentEvent, ModelInfo, SessionSummary } from "../rpc/types";
import { agentBridge } from "./agentBridge";
import { newChatModel } from "./newChatModel";

/** Subset of the `get_state` response we read. */
type PiState = {
  model?: ModelInfo;
  thinkingLevel?: string;
  isStreaming?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  messageCount?: number;
};

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
  // skill_used analytics: resolve a skill to native-or-custom without leaking
  // custom identities. The lookup refreshes on the same signal as the composer
  // picker (every skills mutation restarts the agent). A use landing before
  // the first fetch resolves reports "custom" — acceptable for analytics.
  let nativeSkills = new Set<string>();
  const refreshNativeSkills = () => {
    skillsApi
      .list()
      .then((r) => {
        nativeSkills = new Set(r.skills.filter((s) => s.native).map((s) => s.name));
      })
      .catch(() => undefined);
  };
  refreshNativeSkills();
  agentApi.onModelsChanged(refreshNativeSkills);
  const trackSkillByName = (name: string, method: "manual" | "auto") => {
    const native = nativeSkills.has(name);
    trackSkillUsed(native ? name : "custom", native ? "native" : "custom", method);
  };
  agentBridge.addEventListener((e) => {
    // Tool + reply analytics live on this singleton listener (not mapEvent,
    // which runs once per active subscription) so each is counted exactly once.
    if (e.type === "tool_execution_end") {
      trackAgentToolUsed(e.toolName, Boolean(e.isError));
      if (e.toolName === "add_transactions" && !e.isError) trackTransactionFirstAdded();
    }
    if (e.type === "tool_execution_start" && e.toolName === "read") {
      // The model activates a skill by reading its SKILL.md (pi's lazy-loading
      // contract) — that read IS the auto usage signal. The path is inspected
      // here only; it never leaves the machine.
      const args = e.args as { path?: unknown; file_path?: unknown } | undefined;
      const raw = args?.path ?? args?.file_path;
      const segments = typeof raw === "string" ? raw.split(/[\\/]/) : [];
      if (segments.at(-1) === "SKILL.md") trackSkillByName(segments.at(-2) ?? "", "auto");
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

  const buildSnapshot = (threadId: string, state: PiState, messages: unknown): PiThreadSnapshot => {
    if (state.model) modelByThread.set(threadId, `${state.model.provider}/${state.model.id}`);
    const list = Array.isArray(messages) ? messages.map(collapseUserMessage) : [];
    return {
      metadata: {
        id: threadId,
        status: running.has(threadId) || state.isStreaming ? "running" : "idle",
        ...(state.sessionName ? { title: mentionsToPlainText(state.sessionName) } : {}),
        ...(state.sessionFile ? { sessionFile: state.sessionFile } : {}),
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
    // Most shapes pass through structurally: pi's wire data already matches the
    // mirror types; our local AgentEvent under-declares fields like
    // `partial`/`contentIndex`, but JSON.parse kept them at runtime, so the casts
    // forward the full payload the reducer needs.
    switch (e.type) {
      case "agent_start":
        return { type: "agent_start" };
      case "agent_end":
        return { type: "agent_end" };
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
      default:
        return { type: (e as { type: string }).type } as unknown as PiClientEventBody;
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
      running.add(threadId); // optimistic — flips status to running before agent_start arrives
      await agentBridge.send(threadId, {
        type: "prompt",
        message,
        ...(input.attachments?.length ? { images: input.attachments } : {}),
        ...(input.streamingBehavior ? { streamingBehavior: input.streamingBehavior } : {}),
      });
    },

    async cancelRun(threadId) {
      await agentBridge.send(threadId, { type: "abort" });
    },

    async clearQueue() {
      // pi exposes no clear-and-return; queue is still reflected via queue_update.
      return { steering: [], followUp: [] };
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
          })
          .catch((err) => {
            emit({ type: "error", error: err instanceof Error ? err.message : String(err) });
            attachLive();
          });
      } else {
        attachLive();
      }

      return () => {
        active = false;
        for (const off of offs) off();
      };
    },
  };

  return client;
}
