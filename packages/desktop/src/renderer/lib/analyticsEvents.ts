// Typed renderer-side analytics events — one function per event, mirroring the
// main-process style of src/main/analytics.ts. All flow through the
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

/** Record a skill being pulled into a chat. `skill` is a built-in's name or
 *  the literal "custom" — custom skill names never leave the machine. Manual =
 *  the user's `/` invocation; auto = the model reading the skill file itself. */
export function trackSkillUsed(skill: string, kind: "official" | "custom", method: "manual" | "auto"): void {
  analyticsApi.track("skill_used", { skill, kind, method });
}

/** Record the marketplace list reaching Settings → Plugins, once per visit.
 *  `plugin_count` is everything published, before the installed ones are
 *  filtered out, so it also says whether the index arrived populated. This is
 *  the denominator the install events are read against. */
export function trackMarketplaceViewed(pluginCount: number): void {
  analyticsApi.track("marketplace_viewed", { plugin_count: pluginCount });
}

/** Record the install confirmation opening, before anything is downloaded —
 *  the opening of the `plugin_install_*` lifecycle that main closes with
 *  `plugin_install_succeeded` or `plugin_install_failed`. Against those two it
 *  is how often the dialog is approved rather than abandoned: for a community
 *  plugin, whether people go ahead past the "not reviewed" warning. */
export function trackPluginInstallStarted(official: boolean): void {
  analyticsApi.track("plugin_install_started", { official });
}

/** Record a prompt idea on the New Chat page being clicked into the composer.
 *  `idea` is the idea's stable id from the hardcoded list, never its text, so
 *  the list can be reworded without breaking the series. */
export function trackPromptIdeaUsed(idea: string): void {
  analyticsApi.track("prompt_idea_used", { idea });
}
