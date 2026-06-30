// A `PiClient` (from @assistant-ui/react-pi) implemented over the pi `--mode rpc`
// child process (spawned by the Electron main process, bridged via IPC) — so the
// official `usePiRuntime` drives all message projection / streaming / tool /
// thread-list rendering, while pi keeps running our `accountant24-extension.js`.
// This is the transport the package leaves open (HTTP/SSE is just one
// implementation); we mirror `client/httpClient.ts` against the sidecar.
//
// pi is single-active-session; the runtime is multi-thread. We bridge that by
// treating `threadId` = pi session-file path and issuing `switch_session` before
// any operation targeting a non-active thread (the user views one thread at a
// time). Every emitted event is stamped with a monotonic per-thread `seq` and a
// derived `turnIndex`, exactly as the node ThreadSupervisor does.

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
import { parseModelId } from "../lib/enabledModels";
import { mentionsToPlainText } from "../lib/mentions";
import { analyticsApi, sessionsApi, settingsApi } from "../rpc/api";
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

let pendingCounter = 0;

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
  /** The session pi currently has loaded (its single active session). */
  let activeThreadId: string | undefined;
  /** Serializes switch_session so events route to the intended thread. */
  let switchChain: Promise<void> = Promise.resolve();
  const seqs = new Map<string, number>();
  const turns = new Map<string, number>();
  // Threads with a run in flight. Tracked here because a NEW thread's first
  // message is sent via createThread (not the controller), so without this the
  // runtime's load() snapshot would report idle and never connect() to the
  // stream — leaving the just-sent message and its reply invisible until a
  // manual refetch. Set on send, cleared on agent_end (runs are on the active
  // session). A persistent listener keeps it accurate even between subscriptions.
  const running = new Set<string>();
  agentBridge.addEventListener((e) => {
    if (!activeThreadId) return;
    if (e.type === "agent_start") running.add(activeThreadId);
    else if (e.type === "agent_end") running.delete(activeThreadId);
  });

  const nextSeq = (threadId: string): number => {
    const n = (seqs.get(threadId) ?? 0) + 1;
    seqs.set(threadId, n);
    return n;
  };

  const ensureActive = (threadId: string): Promise<void> => {
    if (threadId === activeThreadId || threadId.startsWith("pending-")) return Promise.resolve();
    switchChain = switchChain.then(async () => {
      if (threadId === activeThreadId) return;
      await agentBridge.request({ type: "switch_session", sessionPath: threadId }, "switch_session");
      activeThreadId = threadId;
    });
    return switchChain;
  };

  const buildSnapshot = (threadId: string, state: PiState, messages: unknown): PiThreadSnapshot => {
    const list = Array.isArray(messages) ? messages : [];
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
        analyticsApi.track("agent_message_sent"); // count only; never the response content
        return { type: "agent_end" };
      case "turn_start": {
        const t = (turns.get(threadId) ?? -1) + 1;
        turns.set(threadId, t);
        return { type: "turn_start", turnIndex: t };
      }
      case "turn_end":
        return { type: "turn_end", turnIndex: turns.get(threadId) ?? 0 };
      case "message_start":
        return { type: "message_start", message: e.message } as unknown as PiClientEventBody;
      case "message_update":
        return {
          type: "message_update",
          message: e.message,
          assistantMessageEvent: e.assistantMessageEvent,
        } as unknown as PiClientEventBody;
      case "message_end":
        return { type: "message_end", message: e.message } as unknown as PiClientEventBody;
      case "tool_execution_start":
        return { type: "tool_execution_start", toolCallId: e.toolCallId, toolName: e.toolName, args: e.args };
      case "tool_execution_update":
        return { type: "tool_execution_update", toolCallId: e.toolCallId, toolName: e.toolName, partialResult: undefined };
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
          title: mentionsToPlainText(s.name || s.firstMessage || baseName(s.path)),
          sessionFile: s.path,
          messageCount: s.messageCount,
          updatedAt: s.modified,
        }),
      );
    },

    async createThread(input) {
      await agentBridge.request({ type: "new_session" }, "new_session");
      analyticsApi.track("chat_created");
      // Pick the model for the fresh session: the model the user chose in the
      // composer for this new chat, else the configured default. Sent before
      // get_state so the snapshot reflects it (stdin commands run in order).
      try {
        const chosen = newChatModel.get() ?? parseModelId((await settingsApi.get()).defaultModel ?? "");
        if (chosen) {
          await agentBridge.send({ type: "set_model", provider: chosen.provider, modelId: chosen.modelId });
        }
      } catch {
        // No model configured / settings unreadable: keep pi's own default.
      } finally {
        // Reset so the next new chat starts from the default again.
        newChatModel.set(undefined);
      }
      const state = await agentBridge.request<PiState>({ type: "get_state" }, "get_state");
      const id = state.sessionFile ?? state.sessionId ?? `pending-${(pendingCounter += 1)}`;
      activeThreadId = id;
      turns.delete(id);
      if (input?.initialMessage) await client.sendMessage(id, input.initialMessage);
      return buildSnapshot(id, state, []);
    },

    async getThread(threadId) {
      await ensureActive(threadId);
      const [msgs, state] = await Promise.all([
        agentBridge.request<{ messages: unknown }>({ type: "get_messages" }, "get_messages"),
        agentBridge.request<PiState>({ type: "get_state" }, "get_state"),
      ]);
      return buildSnapshot(threadId, state, msgs.messages);
    },

    async sendMessage(threadId, input: PiSendMessageInput) {
      await ensureActive(threadId);
      analyticsApi.track("user_message_sent"); // count only; never the message content
      running.add(threadId); // optimistic — flips status to running before agent_start arrives
      await agentBridge.send({
        type: "prompt",
        message: input.content,
        ...(input.attachments?.length ? { images: input.attachments } : {}),
        ...(input.streamingBehavior ? { streamingBehavior: input.streamingBehavior } : {}),
      });
    },

    async cancelRun() {
      await agentBridge.send({ type: "abort" });
    },

    async clearQueue() {
      // pi exposes no clear-and-return; queue is still reflected via queue_update.
      return { steering: [], followUp: [] };
    },

    async getAvailableModels() {
      const data = await agentBridge.request<{ models?: ModelInfo[] }>(
        { type: "get_available_models" },
        "get_available_models",
      );
      return (data.models ?? []).map(toModelInfo);
    },

    async setModel(threadId, input) {
      await ensureActive(threadId);
      await agentBridge.send({ type: "set_model", provider: input.provider, modelId: input.modelId });
    },

    async setThinkingLevel(threadId, level: PiThinkingLevel) {
      await ensureActive(threadId);
      await agentBridge.send({ type: "set_thinking_level", level });
    },

    async renameThread(threadId, title) {
      await ensureActive(threadId);
      await agentBridge.send({ type: "set_session_name", name: title });
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

    async respondToHostUiRequest(_threadId, response: PiHostUiResponse) {
      // Auto-approval in agentBridge means the runtime normally never calls this;
      // honor it anyway for completeness.
      if ("confirmed" in response) {
        await agentBridge.send({ type: "extension_ui_response", id: response.requestId, confirmed: response.confirmed });
      } else if ("value" in response) {
        await agentBridge.send({ type: "extension_ui_response", id: response.requestId, value: response.value, confirmed: true });
      } else {
        await agentBridge.send({ type: "extension_ui_response", id: response.requestId, confirmed: false });
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
            const body = mapEvent(threadId, e);
            if (body) emit(body);
          }),
        );
        offs.push(agentBridge.addErrorListener((msg) => emit({ type: "error", error: msg })));
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
