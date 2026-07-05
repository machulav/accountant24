// Typed renderer-side analytics events — one function per event, mirroring the
// main-process style of electron/main/analytics.ts. All flow through the
// generic analytics_track IPC channel; main enforces the opt-out. Coarse
// string/number props only — never user content (message text, filenames,
// tool args, …).

import { analyticsApi } from "../rpc/api";

/** Record a new chat being started. */
export function trackChatCreated(): void {
  analyticsApi.track("chat_created");
}

/** Record a user message send. Count + coarse props only; `model` is the
 *  session's `provider/modelId` label. */
export function trackUserMessageSent(hasAttachment: boolean, model?: string): void {
  analyticsApi.track("user_message_sent", {
    has_attachment: hasAttachment ? "true" : "false",
    ...(model ? { model } : {}),
  });
}

/** One-time milestone: the install's first user message. */
export function trackUserFirstMessageSent(): void {
  analyticsApi.trackOnce("user_first_message_sent");
}

/** Record an agent reply (count only; never the response content). */
export function trackAgentMessageSent(): void {
  analyticsApi.track("agent_message_sent");
}

/** Record a tool run finishing. Tool name + outcome only. */
export function trackAgentToolUsed(tool: string, isError: boolean): void {
  analyticsApi.track("agent_tool_used", { tool, status: isError ? "error" : "ok" });
}

/** One-time milestone: the first transaction landing in the ledger. */
export function trackTransactionFirstAdded(): void {
  analyticsApi.trackOnce("transaction_first_added");
}

/** Record a file landing in the composer (even if the message is never sent).
 *  Coarse kind only — never the filename or content. */
export function trackAttachmentAdded(kind: "image" | "pdf" | "csv" | "other"): void {
  analyticsApi.track("attachment_added", { kind });
}
