// The interactive subscription (OAuth) sign-in flow, used by the Settings →
// Providers section. pi's AuthStorage.login streams progress, prompts, and a
// browser-auth URL over the "auth-event" channel; this hook owns that
// subscription, the pending-request handshake, and cleanup, and leaves the
// markup to the caller. The state transitions live in the pure reducer
// (oauthLoginState.ts).

import { useCallback, useEffect, useReducer, useRef } from "react";
import { initialOAuthLoginState, type OAuthLoginState, reduceOAuthLogin } from "@/lib/oauthLoginState";
import { authApi } from "@/rpc/api";
import type { AuthEvent } from "@/rpc/types";

export type { OAuthPendingRequest } from "@/lib/oauthLoginState";

export interface OAuthLogin extends OAuthLoginState {
  /** Begin signing in to a provider. */
  start: (providerId: string) => Promise<void>;
  /** Answer the current request (null cancels/declines it). */
  respond: (value: string | null) => void;
  /** Abort an in-progress sign-in. */
  cancel: () => void;
  /** Clear the error left behind by a failed sign-in. */
  dismissError: () => void;
}

/** `onDone` fires once a sign-in completes successfully. */
export function useOAuthLogin(onDone?: () => void): OAuthLogin {
  const [state, dispatch] = useReducer(reduceOAuthLogin, initialOAuthLoginState);
  const unlisteners = useRef<Array<() => void>>([]);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  // Latest pending request, so respond() can send outside any state updater
  // (side effects in updaters run twice under StrictMode).
  const requestRef = useRef(state.request);
  requestRef.current = state.request;

  const cleanup = useCallback(() => {
    for (const un of unlisteners.current) un();
    unlisteners.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const onAuthEvent = useCallback(
    (event: AuthEvent) => {
      dispatch({ type: "event", event });
      if (event.type === "done") {
        cleanup();
        onDoneRef.current?.();
      } else if (event.type === "error") {
        cleanup();
      }
    },
    [cleanup],
  );

  const start = useCallback(
    async (providerId: string) => {
      dispatch({ type: "start", provider: providerId });
      cleanup();
      unlisteners.current.push(await authApi.onEvent(onAuthEvent));
      unlisteners.current.push(await authApi.onTerminated((code) => dispatch({ type: "terminated", code })));
      await authApi.login(providerId);
    },
    [cleanup, onAuthEvent],
  );

  const respond = useCallback((value: string | null) => {
    const req = requestRef.current;
    if (!req) return;
    dispatch({ type: "respond" });
    authApi.loginRespond(req.id, value).catch(() => undefined);
  }, []);

  const cancel = useCallback(() => {
    authApi.loginCancel().catch(() => undefined);
    cleanup();
    dispatch({ type: "cancel" });
  }, [cleanup]);

  const dismissError = useCallback(() => dispatch({ type: "dismissError" }), []);

  return { ...state, start, respond, cancel, dismissError };
}
