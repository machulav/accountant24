// Subset of the pi RPC protocol and the auth-helper protocol that the UI uses.
//
// Shapes that cross the IPC bridge are defined once in src/shared/types.ts and
// re-exported here, so consumers keep importing everything from "@/rpc/types".

import type { PluginInfo, PluginPreview } from "../../shared/types";

export type {
  AccountBalance,
  AppSettings,
  LedgerAmount,
  LedgerMentions,
  LedgerPosting,
  LedgerTransaction,
  LedgerTransactionStatus,
  MarketplaceEntry,
  MarketplaceRequest,
  MarketplaceResult,
  NetWorth,
  NetWorthSection,
  NetWorthTotal,
  PluginAddRequest,
  PluginInfo,
  PluginPreview,
  PluginSkillInfo,
} from "../../shared/types";

// ---- Models -------------------------------------------------------------

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
}

/** provider id -> pi's default model id for it. */
export type ProviderDefaults = Record<string, string>;

// ---- App settings (app-owned config in <workspace>/app-settings.json) ---

/** A concrete model pick: provider + the provider's model id. */
export interface ModelRef {
  provider: string;
  modelId: string;
}

// ---- Plugins (Settings → Plugins) ----------------------------------------

export interface PluginsList {
  plugins: PluginInfo[];
}

/** What a repository turned out to contain, before anything is installed. */
export type PluginInspectResult = { type: "plugin"; plugin: PluginPreview } | { type: "error"; message?: string };

export interface PluginAddResult {
  type: "done" | "error";
  message?: string;
  name?: string;
}

/** What main reports over `plugins-event`: progress lines while an install
 *  runs, and a nudge whenever the store changed on its own (the default
 *  plugins landing on a first launch), so open lists reload. */
export type PluginsEvent = { type: "progress"; message: string } | { type: "changed" };

// ---- Auth helper records (`accountant24 auth ...`) ----------------------

export interface AuthProviderRow {
  provider: string;
  displayName: string;
  oauth: boolean;
  configured: boolean;
  source?: string;
  /** Human label for how a configured provider is authenticated (e.g. "Subscription", "API key"). */
  connection?: string;
  /** Whether the credential lives in auth.json and can be logged out (vs env / models.json). */
  removable?: boolean;
}

export interface AuthStatus {
  type: "status";
  providers: AuthProviderRow[];
  availableModels: number;
  anyConfigured: boolean;
}

export interface OAuthProviderRow {
  id: string;
  name: string;
}

export interface AuthProviders {
  type: "providers";
  oauth: OAuthProviderRow[];
  all: AuthProviderRow[];
}

export interface AuthModels {
  type: "models";
  models: ModelInfo[];
  /** pi's opinionated default model id per provider, used to preselect a
   *  default. Absent providers (e.g. Ollama) have no opinion. */
  providerDefaults: ProviderDefaults;
}

export interface OllamaInfo {
  type: "ollama";
  running: boolean;
  models: string[];
}

// Streamed during an interactive OAuth login.
export type AuthEvent =
  | { type: "auth"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "prompt"; id: string; message: string; placeholder?: string; allowEmpty?: boolean }
  | { type: "select"; id: string; message: string; options: { id: string; label: string }[] }
  | { type: "manual_code"; id: string }
  | { type: "progress"; message: string }
  | { type: "done"; provider?: string }
  | { type: "error"; message: string };

// ---- Agent RPC events (subset we render) --------------------------------

export interface AgentMessage {
  role: string;
  content?: unknown;
  /** Set on assistant messages: how the turn ended ("stop" | "error" | "aborted" | "length" | ...). */
  stopReason?: string;
  /** Provider error text when stopReason is "error". */
  errorMessage?: string;
  /** Set on compactionSummary messages: the text pi kept in place of the old history. */
  summary?: string;
  /** Set on compactionSummary messages: context size before the compaction. */
  tokensBefore?: number;
  timestamp?: number;
}

export interface ToolResult {
  content?: { type: string; text?: string }[];
}

export interface AssistantDelta {
  type: string; // text_delta | thinking_delta | text_start | done | ...
  delta?: string;
}

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; willRetry?: boolean }
  | { type: "agent_settled" }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | {
      type: "compaction_end";
      reason: "manual" | "threshold" | "overflow";
      result?: { summary?: string; tokensBefore?: number };
      aborted?: boolean;
      willRetry?: boolean;
      errorMessage?: string;
    }
  | { type: "auto_retry_start"; attempt: number; delayMs: number; errorMessage?: string }
  | { type: "auto_retry_end"; success: boolean }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantDelta }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result?: ToolResult; isError?: boolean }
  | {
      type: "extension_ui_request";
      id: string;
      method: string;
      title?: string;
      message?: string;
      options?: string[];
      placeholder?: string;
    }
  | { type: "response"; id?: string; command: string; success: boolean; data?: unknown; error?: string };

/** An agent event tagged with the session it came from. The pi wire event is
 *  anonymous; main tags each line with its child's session path so the
 *  renderer can route concurrent sessions' streams. */
export type SessionAgentEvent = AgentEvent & { sessionPath: string };

// ---- Sessions (from the sessions helper) --------------------------------

export interface SessionSummary {
  path: string;
  id: string;
  name: string;
  firstMessage: string;
  messageCount: number;
  modified: string;
}
