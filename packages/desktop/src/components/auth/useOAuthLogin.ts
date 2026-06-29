// The interactive subscription (OAuth) sign-in flow, shared by the Login screen
// and the Settings → Providers section. pi's AuthStorage.login streams progress,
// prompts, and a browser-auth URL over the "auth-event" channel; this hook owns
// that subscription, the pending-request handshake, and cleanup, and leaves the
// markup to each caller (Login styles its own card; Settings uses the shadcn
// theme).

import { useCallback, useEffect, useRef, useState } from "react";
import { authApi } from "../../rpc/api";
import type { AuthEvent } from "../../rpc/types";

/** A question pi is waiting on the user to answer mid-login. */
export interface OAuthPendingRequest {
  id: string;
  kind: "prompt" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: { id: string; label: string }[];
}

export interface OAuthLogin {
  /** The provider id currently signing in, or null when idle. */
  active: string | null;
  /** Human-readable progress lines to show the user. */
  log: string[];
  /** A question awaiting the user's answer, or null. */
  request: OAuthPendingRequest | null;
  /** The last error, if the flow failed. */
  error: string | null;
  /** Begin signing in to a provider. */
  start: (providerId: string) => Promise<void>;
  /** Answer the current request (null cancels/declines it). */
  respond: (value: string | null) => void;
  /** Abort an in-progress sign-in. */
  cancel: () => void;
}

/** `onDone` fires once a sign-in completes successfully. */
export function useOAuthLogin(onDone?: () => void): OAuthLogin {
  const [active, setActive] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [request, setRequest] = useState<OAuthPendingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlisteners = useRef<Array<() => void>>([]);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const cleanup = useCallback(() => {
    for (const un of unlisteners.current) un();
    unlisteners.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const onAuthEvent = useCallback(
    (event: AuthEvent) => {
      switch (event.type) {
        case "auth":
          setLog((l) => [...l, "Opened your browser to authorize. Complete sign-in there…"]);
          break;
        case "device_code":
          setLog((l) => [...l, `Enter code ${event.userCode} at ${event.verificationUri}`]);
          break;
        case "progress":
          setLog((l) => [...l, event.message]);
          break;
        case "prompt":
          setRequest({ id: event.id, kind: "prompt", message: event.message, placeholder: event.placeholder });
          break;
        case "select":
          setRequest({ id: event.id, kind: "select", message: event.message, options: event.options });
          break;
        case "manual_code":
          setRequest({ id: event.id, kind: "manual_code", message: "Paste the code from your browser" });
          break;
        case "done":
          cleanup();
          setActive(null);
          onDoneRef.current?.();
          break;
        case "error":
          setError(event.message);
          setActive(null);
          cleanup();
          break;
      }
    },
    [cleanup],
  );

  const start = useCallback(
    async (providerId: string) => {
      setActive(providerId);
      setLog([]);
      setError(null);
      setRequest(null);
      cleanup();
      unlisteners.current.push(await authApi.onEvent(onAuthEvent));
      unlisteners.current.push(
        await authApi.onTerminated((code) => {
          if (code && code !== 0) setError("Login process exited unexpectedly.");
        }),
      );
      await authApi.login(providerId);
    },
    [cleanup, onAuthEvent],
  );

  const respond = useCallback(
    (value: string | null) => {
      setRequest((req) => {
        if (req) authApi.loginRespond(req.id, value).catch(() => undefined);
        return null;
      });
    },
    [],
  );

  const cancel = useCallback(() => {
    authApi.loginCancel().catch(() => undefined);
    cleanup();
    setActive(null);
    setRequest(null);
  }, [cleanup]);

  return { active, log, request, error, start, respond, cancel };
}
