// Pure state machine for an interactive OAuth sign-in. useOAuthLogin drives it
// with events from the "auth-event" stream and UI actions; keeping the
// transitions pure makes the flow unit-testable without React.

import type { AuthEvent } from "../../rpc/types";

/** A question pi is waiting on the user to answer mid-login. */
export interface OAuthPendingRequest {
  id: string;
  kind: "prompt" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: { id: string; label: string }[];
}

export interface OAuthLoginState {
  /** The provider id currently signing in, or null when idle. */
  active: string | null;
  /** Human-readable progress lines to show the user. */
  log: string[];
  /** A question awaiting the user's answer, or null. */
  request: OAuthPendingRequest | null;
  /** The last error, if the flow failed. */
  error: string | null;
  /** The provider whose sign-in produced `error`. Survives `active` going null,
   *  so a per-provider view can still show the failure after the in-progress
   *  panel unmounts. */
  errorProvider: string | null;
}

export const initialOAuthLoginState: OAuthLoginState = {
  active: null,
  log: [],
  request: null,
  error: null,
  errorProvider: null,
};

export type OAuthLoginAction =
  | { type: "start"; provider: string }
  | { type: "event"; event: AuthEvent }
  | { type: "respond" }
  | { type: "cancel" }
  | { type: "terminated"; code: number | null };

export function reduceOAuthLogin(state: OAuthLoginState, action: OAuthLoginAction): OAuthLoginState {
  switch (action.type) {
    case "start":
      return { ...initialOAuthLoginState, active: action.provider };
    case "respond":
      return { ...state, request: null };
    case "cancel":
      return { ...state, active: null, request: null };
    case "terminated":
      if (action.code == null || action.code === 0) return state;
      return { ...state, error: "Login process exited unexpectedly.", errorProvider: state.active };
    case "event":
      return applyEvent(state, action.event);
  }
}

function applyEvent(state: OAuthLoginState, event: AuthEvent): OAuthLoginState {
  switch (event.type) {
    case "auth":
      return { ...state, log: [...state.log, "Opened your browser to authorize. Complete sign-in there…"] };
    case "device_code":
      return { ...state, log: [...state.log, `Enter code ${event.userCode} at ${event.verificationUri}`] };
    case "progress":
      return { ...state, log: [...state.log, event.message] };
    case "prompt":
      return {
        ...state,
        request: { id: event.id, kind: "prompt", message: event.message, placeholder: event.placeholder },
      };
    case "select":
      return { ...state, request: { id: event.id, kind: "select", message: event.message, options: event.options } };
    case "manual_code":
      return { ...state, request: { id: event.id, kind: "manual_code", message: "Paste the code from your browser" } };
    case "done":
      return { ...state, active: null };
    case "error":
      // Keep the message AND remember whose sign-in failed: `active` goes null
      // (the flow is over), but the error must outlive the in-progress panel.
      return { ...state, error: event.message, errorProvider: state.active, active: null };
  }
}
