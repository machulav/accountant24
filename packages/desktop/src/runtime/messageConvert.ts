// Convert pi AgentMessage[] (from get_messages) into assistant-ui ThreadMessageLike[]
// for loading a past session's history. Tolerant of pi's message shape: content may
// be a string or an array of parts.

import type { ThreadMessageLike } from "@assistant-ui/react";

type PiPart = { type?: string; text?: string; toolName?: string; toolCallId?: string; args?: unknown; result?: unknown };
type PiMessage = { role?: string; content?: string | PiPart[] };

function textOf(content: string | PiPart[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

export function convertMessages(messages: unknown): ThreadMessageLike[] {
  if (!Array.isArray(messages)) return [];
  const out: ThreadMessageLike[] = [];
  for (const raw of messages as PiMessage[]) {
    const role = raw.role;
    if (role === "user") {
      const text = textOf(raw.content);
      if (text) out.push({ role: "user", content: [{ type: "text", text }] });
    } else if (role === "assistant") {
      const text = textOf(raw.content);
      if (text) out.push({ role: "assistant", content: [{ type: "text", text }] });
    }
    // Tool/system messages are omitted from the rehydrated transcript in v1.
  }
  return out;
}
