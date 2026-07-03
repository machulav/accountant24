// Subset of the pi RPC protocol and the auth-helper protocol that the UI uses.

// ---- Ledger mentions (@-mention picker data) ----------------------------

/** Entity names available to the chat composer's @-mention popover, sourced
 *  from `hledger` against the workspace journal. */
export interface LedgerMentions {
  accounts: string[];
  payees: string[];
  tags: string[];
}

// ---- Models -------------------------------------------------------------

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
}

// ---- App settings (app-owned config in ~/Accountant24/settings.json) -----

/** A concrete model pick: provider + the provider's model id. */
export interface ModelRef {
  provider: string;
  modelId: string;
}

/** The app's own settings (distinct from pi's config, which we don't write). */
export interface AppSettings {
  /** Model new chats start with, as a `provider/modelId` id (same format as enabledModels). */
  defaultModel?: string;
  /** `provider/modelId` ids the user can pick from in chat. Empty/absent = all enabled. */
  enabledModels?: string[];
  /** Anonymous usage analytics opt-out. Absent = on (the default). */
  analyticsEnabled?: boolean;
}

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
  usesCallbackServer: boolean;
}

export interface AuthProviders {
  type: "providers";
  oauth: OAuthProviderRow[];
  all: AuthProviderRow[];
}

export interface AuthModels {
  type: "models";
  models: ModelInfo[];
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
  | { type: "agent_end" }
  | { type: "turn_start" }
  | { type: "turn_end" }
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

// ---- Sessions (from the sessions helper) --------------------------------

export interface SessionSummary {
  path: string;
  id: string;
  name: string;
  firstMessage: string;
  messageCount: number;
  modified: string;
}
