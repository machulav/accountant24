// ChatModelAdapter for assistant-ui's useLocalRuntime: sends the latest user
// message to the pi sidecar and folds the agent-event stream into cumulative
// assistant-ui content (text, reasoning, tool calls). Yields the full snapshot on
// each event (assistant-ui replaces content per yield, not append).

import type { ChatModelAdapter, ChatModelRunResult, ThreadAssistantMessagePart } from "@assistant-ui/react";
import { agentBridge } from "./agentBridge";

function lastUserText(messages: readonly { role: string; content: readonly unknown[] }[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "";
  return (last.content as { type: string; text?: string }[])
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

type ToolState = { toolName: string; args: unknown; result?: string; isError?: boolean };

export const agentAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const prompt = lastUserText(messages);
    let text = "";
    let reasoning = "";
    const tools = new Map<string, ToolState>();

    const snapshot = (): ChatModelRunResult => {
      const content: ThreadAssistantMessagePart[] = [];
      if (reasoning) content.push({ type: "reasoning", text: reasoning });
      if (text) content.push({ type: "text", text });
      for (const [toolCallId, t] of tools) {
        content.push({
          type: "tool-call",
          toolCallId,
          toolName: t.toolName,
          args: (t.args ?? {}) as Record<string, unknown>,
          argsText: JSON.stringify(t.args ?? {}),
          ...(t.result !== undefined ? { result: t.result } : {}),
          ...(t.isError ? { isError: true } : {}),
        } as ThreadAssistantMessagePart);
      }
      return { content };
    };

    for await (const e of agentBridge.runPrompt(prompt, abortSignal)) {
      switch (e.type) {
        case "message_update": {
          const d = e.assistantMessageEvent;
          if (d.type === "text_delta") text += d.delta ?? "";
          else if (d.type === "thinking_delta") reasoning += d.delta ?? "";
          else break;
          yield snapshot();
          break;
        }
        case "tool_execution_start":
          tools.set(e.toolCallId, { toolName: e.toolName, args: e.args });
          yield snapshot();
          break;
        case "tool_execution_end": {
          const prev = tools.get(e.toolCallId) ?? { toolName: e.toolName, args: {} };
          const resultText = (e.result?.content ?? [])
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("\n")
            .trim();
          tools.set(e.toolCallId, { ...prev, result: resultText, isError: e.isError });
          yield snapshot();
          break;
        }
        case "agent_end":
          return;
        default:
          break;
      }
    }
  },
};
