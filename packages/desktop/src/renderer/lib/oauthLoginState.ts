// Pure state machine for an interactive OAuth sign-in. useOAuthLogin drives it
// with events from the "auth-event" stream and UI actions; keeping the
// transitions pure makes the flow unit-testable without React.

import type { AuthEvent } from "@/rpc/types";

/** A question pi is waiting on the user to answer mid-login. */
export interface OAuthPendingRequest {
  id: string;
  kind: "prompt" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  /** Whether a blank answer is a valid response (e.g. "blank for the default"). */
  allowEmpty?: boolean;
  options?: { id: string; label: string }[];
}

export interface OAuthLoginState {
  /** The provider id currently signing in, or null when idle. */
  active: string | null;
  /** Human-readable progress lines to show the user. */
  log: string[];
  /** A question awaiting the user's answer, or null. */
  request: OAuthPendingRequest | null;
  /** The sign-in URL opened in the browser, kept as a manual fallback link. */
  authUrl: string | null;
  /** A device code the user must enter in the browser, shown prominently. */
  deviceCode: { userCode: string; verificationUri: string } | null;
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
  authUrl: null,
  deviceCode: null,
  error: null,
  errorProvider: null,
};

export type OAuthLoginAction =
  | { type: "start"; provider: string }
  | { type: "event"; event: AuthEvent }
  | { type: "respond" }
  | { type: "cancel" }
  | { type: "dismissError" }
  | { type: "terminated"; code: number | null };

export function reduceOAuthLogin(state: OAuthLoginState, action: OAuthLoginAction): OAuthLoginState {
  switch (action.type) {
    case "start":
      return { ...initialOAuthLoginState, active: action.provider };
    case "respond":
      return { ...state, request: null };
    case "cancel":
      return { ...state, active: null, request: null };
    case "dismissError":
      return { ...state, error: null, errorProvider: null };
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
      return {
        ...state,
        authUrl: event.url,
        log: [...state.log, "Opened your browser to authorize. Complete sign-in there…"],
      };
    case "device_code":
      // Kept out of the log: the UI renders the code as its own prominent
      // block (with a copy button) rather than as a progress line.
      return { ...state, deviceCode: { userCode: event.userCode, verificationUri: event.verificationUri } };
    case "progress":
      return { ...state, log: [...state.log, event.message] };
    case "prompt":
      return {
        ...state,
        request: {
          id: event.id,
          kind: "prompt",
          message: event.message,
          placeholder: event.placeholder,
          allowEmpty: event.allowEmpty,
        },
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
