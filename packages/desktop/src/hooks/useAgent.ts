// Bridges the RPC agent sidecar to React state: starts the agent, subscribes to
// its event stream, and folds those events into a renderable chat transcript.

import { useCallback, useEffect, useRef, useState } from "react";
import { agentApi, dlog } from "../rpc/api";
import type { AgentEvent, ChatItem, ModelInfo, ToolResult, UiDialog } from "../rpc/types";

/** Friendly verbs for tool cards; falls back to the raw tool name. */
const TOOL_LABELS: Record<string, string> = {
  query: "Queried your ledger",
  add_transactions: "Added transactions",
  commit_and_push: "Saved changes",
  copy_file_to_workspace: "Archived file",
  extract_text: "Read file",
  validate: "Validated ledger",
  update_memory: "Updated memory",
  read: "Read file",
  bash: "Ran a command",
  edit: "Edited a file",
  write: "Wrote a file",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

function textFromResult(result?: ToolResult): string {
  return (result?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

export interface UseAgent {
  items: ChatItem[];
  isStreaming: boolean;
  dialog: UiDialog | null;
  error: string | null;
  model: ModelInfo | null;
  models: ModelInfo[];
  send: (text: string) => void;
  abort: () => void;
  newSession: () => void;
  selectModel: (provider: string, id: string) => void;
  answerDialog: (response: { confirmed?: boolean; value?: string; cancelled?: boolean }) => void;
}

export function useAgent(): UseAgent {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [dialog, setDialog] = useState<UiDialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);

  const assistantId = useRef<string | null>(null);
  const counter = useRef(0);
  const dialogRef = useRef<UiDialog | null>(null);
  const modelRef = useRef<ModelInfo | null>(null);
  const modelsRef = useRef<ModelInfo[]>([]);
  const producedOutput = useRef(false);
  const nextId = useCallback(() => `m${++counter.current}`, []);

  // Mirror dialog into a ref so answerDialog's side effect stays out of setState.
  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  const startAssistant = useCallback((): string => {
    const id = nextId();
    assistantId.current = id;
    setItems((prev) => [...prev, { kind: "assistant", id, text: "", thinking: "", done: false }]);
    return id;
  }, [nextId]);

  const finishOpenAssistant = useCallback(() => {
    assistantId.current = null;
    setItems((prev) =>
      prev.map((it) => (it.kind === "assistant" && !it.done ? { ...it, done: true } : it)),
    );
  }, []);

  const selectModel = useCallback((provider: string, id: string) => {
    agentApi.send({ type: "set_model", provider, modelId: id }).catch(() => undefined);
  }, []);

  // The agent's default active model may be one the user has no auth for (e.g.
  // openai/gpt-5.5 when they only have the openai-codex OAuth subscription),
  // which makes every prompt fail with "No API key found". If the active model
  // isn't in the available (authed) list, switch to the first available one.
  const maybeAutoSwitchModel = useCallback(() => {
    const active = modelRef.current;
    const available = modelsRef.current;
    if (!active || available.length === 0) return;
    const authed = available.some((m) => m.provider === active.provider && m.id === active.id);
    if (!authed) {
      // Prefer the same model id via an authed provider (gpt-5.5/openai ->
      // gpt-5.5/openai-codex); otherwise fall back to the first available.
      const target = available.find((m) => m.id === active.id) ?? available[0];
      dlog(`auto-switch: ${active.provider}/${active.id} unauthed -> ${target.provider}/${target.id}`);
      selectModel(target.provider, target.id);
    }
  }, [selectModel]);

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "agent_start":
          setIsStreaming(true);
          setError(null);
          producedOutput.current = false;
          break;
        case "agent_end":
          setIsStreaming(false);
          finishOpenAssistant();
          // Some model/auth combos return an empty turn (e.g. Claude Pro/Max
          // OAuth with a custom system prompt). Surface a hint instead of silence.
          if (!producedOutput.current) {
            setItems((prev) => [
              ...prev,
              {
                kind: "assistant",
                id: nextId(),
                text:
                  "⚠️ The model returned an empty response. Switch the model (top-right) to one your account can use — e.g. GPT-5.5, or a local Ollama model.",
                thinking: "",
                done: true,
              },
            ]);
          }
          break;
        // Assistant bubbles are created lazily on the first text delta, so an
        // empty turn leaves no blank bubble.
        case "message_update": {
          const delta = event.assistantMessageEvent?.delta ?? "";
          if (!delta) break;
          const id = assistantId.current ?? startAssistant();
          const kind = event.assistantMessageEvent.type;
          if (kind === "text_delta") producedOutput.current = true;
          setItems((prev) =>
            prev.map((it) => {
              if (it.kind !== "assistant" || it.id !== id) return it;
              if (kind === "thinking_delta") return { ...it, thinking: it.thinking + delta };
              if (kind === "text_delta") return { ...it, text: it.text + delta };
              return it;
            }),
          );
          break;
        }
        case "message_end":
          finishOpenAssistant();
          break;
        case "tool_execution_start":
          producedOutput.current = true;
          setItems((prev) => [
            ...prev,
            { kind: "tool", id: event.toolCallId, name: toolLabel(event.toolName), status: "running", result: "" },
          ]);
          break;
        case "tool_execution_end": {
          const result = textFromResult(event.result);
          setItems((prev) =>
            prev.map((it) =>
              it.kind === "tool" && it.id === event.toolCallId
                ? { ...it, status: event.isError ? "error" : "done", result }
                : it,
            ),
          );
          break;
        }
        case "extension_ui_request":
          if (event.method === "confirm" || event.method === "select" || event.method === "input") {
            setDialog({
              id: event.id,
              method: event.method,
              title: event.title,
              message: event.message,
              options: event.options,
              placeholder: event.placeholder,
            });
          }
          break;
        case "response":
          if (event.command === "get_state" && event.data) {
            const m = (event.data as { model?: ModelInfo }).model;
            if (m) {
              modelRef.current = m;
              setModel(m);
              maybeAutoSwitchModel();
            }
          } else if (event.command === "get_available_models" && event.data) {
            const list = (event.data as { models?: ModelInfo[] }).models ?? [];
            modelsRef.current = list;
            setModels(list);
            maybeAutoSwitchModel();
          } else if (event.command === "set_model" && event.data) {
            const m = event.data as ModelInfo;
            modelRef.current = m;
            setModel(m);
          }
          break;
        default:
          break;
      }
    },
    [startAssistant, finishOpenAssistant, maybeAutoSwitchModel, nextId],
  );

  useEffect(() => {
    let unEvent: UnlistenLike;
    let unTerm: UnlistenLike;
    let unErr: UnlistenLike;
    let cancelled = false;

    // If the sidecar dies mid-stream, clear streaming so the composer re-enables.
    const onStopped = (message: string) => {
      setIsStreaming(false);
      finishOpenAssistant();
      setError(message);
    };

    (async () => {
      dlog("useAgent effect: calling agent_start");
      await agentApi.start();
      dlog("useAgent effect: agent_start resolved, attaching listeners");
      unEvent = await agentApi.onEvent(handleEvent);
      unTerm = await agentApi.onTerminated(() => onStopped("The agent stopped unexpectedly."));
      unErr = await agentApi.onError((message) => onStopped(message));
      if (cancelled) {
        unEvent?.();
        unTerm?.();
        unErr?.();
        return;
      }
      // Hydrate current model + the available-model list.
      await agentApi.send({ type: "get_state" });
      await agentApi.send({ type: "get_available_models" });
    })().catch((e) => {
      dlog(`agent init FAILED: ${e}`);
      setError(String(e));
    });

    return () => {
      cancelled = true;
      unEvent?.();
      unTerm?.();
      unErr?.();
    };
  }, [handleEvent, finishOpenAssistant]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setItems((prev) => [...prev, { kind: "user", id: nextId(), text: trimmed }]);
      dlog(`send: submitting prompt (${trimmed.length} chars)`);
      agentApi
        .send({ type: "prompt", message: trimmed })
        .then(() => dlog("send: agent_send resolved"))
        .catch((e) => {
          dlog(`send FAILED: ${e}`);
          setError(String(e));
        });
    },
    [nextId],
  );

  const abort = useCallback(() => {
    agentApi.send({ type: "abort" }).catch(() => undefined);
  }, []);

  const newSession = useCallback(() => {
    agentApi.send({ type: "new_session" }).catch(() => undefined);
    setItems([]);
    assistantId.current = null;
  }, []);

  const answerDialog = useCallback(
    (response: { confirmed?: boolean; value?: string; cancelled?: boolean }) => {
      const current = dialogRef.current;
      if (!current) return;
      agentApi
        .send({ type: "extension_ui_response", id: current.id, ...response })
        .catch(() => undefined);
      dialogRef.current = null;
      setDialog(null);
    },
    [],
  );

  return {
    items,
    isStreaming,
    dialog,
    error,
    model,
    models,
    send,
    abort,
    newSession,
    selectModel,
    answerDialog,
  };
}

/** Unlisten functions are sync; allow undefined before they resolve. */
type UnlistenLike = (() => void) | undefined;
