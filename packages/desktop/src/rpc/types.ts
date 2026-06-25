// Subset of the pi RPC protocol and the auth-helper protocol that the UI uses.

// ---- Models -------------------------------------------------------------

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
}

// ---- Auth helper records (`accountant24 auth ...`) ----------------------

export interface AuthProviderRow {
  provider: string;
  displayName: string;
  oauth: boolean;
  configured: boolean;
  source?: string;
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
