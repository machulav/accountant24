// Interactive OAuth login — the pi SDK login flow streamed to the renderer
// over "auth-event", with prompts answered back over IPC.

import type { AuthStorage } from "@earendil-works/pi-coding-agent";
import { type BrowserWindow, ipcMain, shell } from "electron";
import { trackProviderConnected } from "../analytics";
import { createRegistry } from "./registry";

type LoginCallbacks = Parameters<AuthStorage["login"]>[1];

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
  const ask = (request: Record<string, unknown>): Promise<string> => {
    const id = `q${++attempt.counter}`;
    return new Promise<string>((res) => {
      attempt.pending.set(id, res);
      send({ ...request, id });
    });
  };

  const callbacks: LoginCallbacks = {
    onAuth: (info) => {
      send({ type: "auth", url: info.url, instructions: info.instructions });
      void shell.openExternal(info.url).catch(() => undefined);
    },
    onDeviceCode: (info) => send({ type: "device_code", ...info }),
    onProgress: (message) => send({ type: "progress", message }),
    onPrompt: (prompt) =>
      ask({ type: "prompt", message: prompt.message, placeholder: prompt.placeholder, allowEmpty: prompt.allowEmpty }),
    onManualCodeInput: () => ask({ type: "manual_code" }),
    onSelect: async (prompt) => {
      const value = await ask({ type: "select", message: prompt.message, options: prompt.options });
      return value === "" ? undefined : value;
    },
    signal: attempt.abort.signal,
  };

  const { authStorage } = createRegistry();
  authStorage
    .login(provider, callbacks)
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
