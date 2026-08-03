// pi session events → ACP session/update notifications.
//
// Pure and total: every pi event maps to at most one ACP update, and anything
// without an ACP equivalent (turn bookkeeping, compaction, queue changes) maps
// to null and is dropped. Keeping this a plain function is what makes the whole
// translation testable without a running agent.

import type { ContentBlock, SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { toolKind, toolTitle } from "./tools";

/** pi's AgentToolResult, narrowed to what we can render. `result` is typed
 *  `any` on the event, so treat every field as untrusted. */
function toolResultContent(result: unknown): ToolCallContent[] {
  if (!result || typeof result !== "object") return [];
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const blocks: ToolCallContent[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const { type, text, data, mimeType } = part as {
      type?: unknown;
      text?: unknown;
      data?: unknown;
      mimeType?: unknown;
    };
    if (type === "text" && typeof text === "string" && text.length > 0) {
      blocks.push({ type: "content", content: { type: "text", text } });
    } else if (type === "image" && typeof data === "string" && typeof mimeType === "string") {
      blocks.push({ type: "content", content: { type: "image", data, mimeType } });
    }
  }
  return blocks;
}

const textChunk = (text: string, kind: "agent_message_chunk" | "agent_thought_chunk"): SessionUpdate =>
  ({ sessionUpdate: kind, content: { type: "text", text } satisfies ContentBlock }) as SessionUpdate;

/** Translate one pi event, or null when it has no ACP equivalent. */
export function toSessionUpdate(event: AgentSessionEvent): SessionUpdate | null {
  switch (event.type) {
    case "message_update": {
      const delta = event.assistantMessageEvent;
      // Only the deltas carry incremental text; the *_end variants repeat the
      // whole block and would duplicate everything already streamed.
      if (delta.type === "text_delta" && delta.delta) return textChunk(delta.delta, "agent_message_chunk");
      if (delta.type === "thinking_delta" && delta.delta) return textChunk(delta.delta, "agent_thought_chunk");
      return null;
    }

    case "tool_execution_start":
      return {
        sessionUpdate: "tool_call",
        toolCallId: event.toolCallId,
        title: toolTitle(event.toolName),
        kind: toolKind(event.toolName),
        // pi only emits this once the call is actually running, so there is no
        // "pending" phase to represent.
        status: "in_progress",
        rawInput: event.args,
      };

    case "tool_execution_end":
      return {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: event.isError ? "failed" : "completed",
        content: toolResultContent(event.result),
        rawOutput: event.result,
      };

    case "session_info_changed":
      return event.name ? { sessionUpdate: "session_info_update", title: event.name } : null;

    default:
      return null;
  }
}
