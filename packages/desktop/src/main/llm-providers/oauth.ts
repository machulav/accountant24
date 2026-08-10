// Interactive OAuth login — the pi SDK login flow streamed to the renderer
// over "auth-event", with prompts answered back over IPC.

import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import { type BrowserWindow, ipcMain, shell } from "electron";
import { trackProviderConnected } from "../analytics";
import { createProviderRuntime } from "./registry";

/** State for one sign-in attempt. Scoped per attempt (not module-wide) so a
 *  superseded attempt settling late can't clobber the active one's abort
 *  controller or pending prompts. */
interface LoginAttempt {
  abort: AbortController;
  pending: Map<string, (value: string) => void>;
  counter: number;
}

let activeLogin: LoginAttempt | null = null;

function authLogin(getWin: () => BrowserWindow | null, provider: string): void {
  activeLogin?.abort.abort();
  const attempt: LoginAttempt = { abort: new AbortController(), pending: new Map(), counter: 0 };
  activeLogin = attempt;

  // Events from a superseded attempt are dropped, so a stale login (e.g. the
  // rejection of the one we just aborted) can't talk over the active one.
  const send = (record: Record<string, unknown>) => {
    if (activeLogin !== attempt) return;
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send("auth-event", record);
  };
  const ask = (request: Record<string, unknown>, signal?: AbortSignal): Promise<string> => {
    const id = `q${++attempt.counter}`;
    return new Promise<string>((resolve, reject) => {
      // pi retracts a question it no longer needs — a pasted-code prompt raced
      // against the browser callback. Drop the pending answer so a late reply
      // can't resolve a question nobody is waiting on.
      const onAbort = () => {
        attempt.pending.delete(id);
        reject(new Error("Prompt cancelled"));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      attempt.pending.set(id, (value) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      });
      send({ ...request, id });
    });
  };

  const interaction: AuthInteraction = {
    signal: attempt.abort.signal,
    notify: (event: AuthEvent) => {
      switch (event.type) {
        case "auth_url":
          send({ type: "auth", url: event.url, instructions: event.instructions });
          void shell.openExternal(event.url).catch(() => undefined);
          break;
        case "device_code":
          send({
            type: "device_code",
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds,
            expiresInSeconds: event.expiresInSeconds,
          });
          break;
        // `info` reads like any other progress line (its optional links have no
        // wire slot), so both land in the same log.
        case "info":
        case "progress":
          send({ type: "progress", message: event.message });
          break;
      }
    },
    prompt: (prompt: AuthPrompt): Promise<string> => {
      if (prompt.type === "manual_code") return ask({ type: "manual_code" }, prompt.signal);
      if (prompt.type === "select") {
        return ask(
          {
            type: "select",
            message: prompt.message,
            options: prompt.options.map((o) => ({ id: o.id, label: o.label })),
          },
          prompt.signal,
        ).then((value) => {
          // A dismissed selector answers with "", which pi's own flows used to
          // report under exactly this message.
          if (value === "") throw new Error("Login cancelled");
          return value;
        });
      }
      return ask(
        {
          type: "prompt",
          message: prompt.message,
          placeholder: prompt.placeholder,
          // pi no longer marks a question as blank-able. Free text is the kind
          // that can mean "blank for the default" (the GitHub Enterprise
          // domain); a secret never usefully is.
          allowEmpty: prompt.type === "text",
        },
        prompt.signal,
      );
    },
  };

  createProviderRuntime()
    .then((runtime) => runtime.login(provider, "oauth", interaction))
    .then(() => {
      trackProviderConnected(provider, "oauth");
      send({ type: "done", provider });
    })
    .catch((error) => send({ type: "error", message: error instanceof Error ? error.message : String(error) }))
    .finally(() => {
      // Only clear if we're still the active attempt — a newer login owns the
      // slot now and must keep its own abort controller + pending prompts.
      if (activeLogin === attempt) activeLogin = null;
    });
}

function authLoginRespond(id: string, value: string | null): void {
  const attempt = activeLogin;
  const res = attempt?.pending.get(id);
  if (attempt && res) {
    attempt.pending.delete(id);
    res(value ?? "");
  }
}

function authLoginCancel(): void {
  activeLogin?.abort.abort();
}

/** Register the interactive OAuth login IPC handlers. */
export function registerOauthIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle("auth_login", (_e, { provider }: { provider: string }) => authLogin(getWin, provider));
  ipcMain.handle("auth_login_respond", (_e, { id, value }: { id: string; value: string | null }) =>
    authLoginRespond(id, value),
  );
  ipcMain.handle("auth_login_cancel", () => authLoginCancel());
}
