// Typed wrappers over the Rust commands and Tauri events.
//
// Commands are defined in src-tauri/src/{agent,auth}.rs. Auth one-shot commands
// return a JSON string (the helper's single output line) which we parse here.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentEvent,
  AuthEvent,
  AuthModels,
  AuthProviders,
  AuthStatus,
  OllamaInfo,
} from "./types";

async function parse<T>(promise: Promise<string>): Promise<T> {
  return JSON.parse(await promise) as T;
}

/** Temporary diagnostics — mirror a line to console + /tmp/a24-desktop.log. */
export function dlog(msg: string): void {
  console.debug("[a24]", msg);
  invoke("debug_log", { msg }).catch(() => undefined);
}

export const agentApi = {
  start: () => invoke<void>("agent_start"),
  send: (command: object) => invoke<void>("agent_send", { payload: JSON.stringify(command) }),
  stop: () => invoke<void>("agent_stop"),
  onEvent: (cb: (event: AgentEvent) => void): Promise<UnlistenFn> =>
    listen<string>("agent-event", (event) => {
      dlog(`agent-event recv: ${String(event.payload).slice(0, 140)}`);
      try {
        cb(JSON.parse(event.payload) as AgentEvent);
      } catch {
        dlog(`PARSE FAIL: ${event.payload}`);
      }
    }),
  onTerminated: (cb: (code: number | null) => void): Promise<UnlistenFn> =>
    listen<number | null>("agent-terminated", (event) => {
      dlog(`agent-terminated code=${event.payload}`);
      cb(event.payload);
    }),
  onError: (cb: (message: string) => void): Promise<UnlistenFn> =>
    listen<string>("agent-error", (event) => {
      dlog(`agent-error: ${event.payload}`);
      cb(event.payload);
    }),
};

export const authApi = {
  status: () => parse<AuthStatus>(invoke<string>("auth_status")),
  providers: () => parse<AuthProviders>(invoke<string>("auth_providers")),
  models: () => parse<AuthModels>(invoke<string>("auth_models")),
  setKey: (provider: string, key: string) =>
    parse<{ type: string; message?: string }>(invoke<string>("auth_set_key", { provider, key })),
  logout: (provider: string) =>
    parse<{ type: string; message?: string }>(invoke<string>("auth_logout", { provider })),
  detectOllama: () => parse<OllamaInfo>(invoke<string>("auth_detect_ollama")),
  addOllama: (model: string) =>
    parse<{ type: string; message?: string }>(invoke<string>("auth_add_ollama", { model })),
  login: (provider: string) => invoke<void>("auth_login", { provider }),
  loginRespond: (id: string, value: string | null) =>
    invoke<void>("auth_login_respond", { id, value }),
  loginCancel: () => invoke<void>("auth_login_cancel"),
  onEvent: (cb: (event: AuthEvent) => void): Promise<UnlistenFn> =>
    listen<string>("auth-event", (event) => {
      try {
        cb(JSON.parse(event.payload) as AuthEvent);
      } catch {
        /* ignore malformed line */
      }
    }),
  onTerminated: (cb: (code: number | null) => void): Promise<UnlistenFn> =>
    listen<number | null>("auth-terminated", (event) => cb(event.payload)),
};
