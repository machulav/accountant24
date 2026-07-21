import { beforeEach, describe, expect, it, vi } from "vitest";

// oauth.ts wraps two I/O boundaries — Electron IPC/shell and the pi SDK login.
// Both are faked; the login handshake (attempt state, prompt correlation,
// supersession) runs for real, driven through the registered IPC handlers.
type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sendToWindow: vi.fn(),
  openExternal: vi.fn(async () => {}),
  authStorage: {
    login: vi.fn<(provider: string, callbacks: unknown) => Promise<void>>(() => new Promise(() => {})),
  },
  trackProviderConnected: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
  shell: { openExternal: h.openExternal },
}));
vi.mock("../../env", () => ({ workspaceDir: () => "/ws" }));
vi.mock("../../analytics", () => ({ trackProviderConnected: h.trackProviderConnected }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  AuthStorage: { create: () => h.authStorage },
  ModelRegistry: { create: () => ({}) },
}));

const win = { isDestroyed: () => false, webContents: { send: h.sendToWindow } };

/** Import oauth.ts fresh (module-level login state) and register its handlers. */
async function setup(getWin: () => unknown = () => win) {
  const { registerOauthIpc } = await import("../oauth");
  registerOauthIpc(getWin as never);
}

const invoke = (channel: string, payload?: unknown) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, payload);
};

/** All records sent to the renderer over the "auth-event" channel so far. */
const authEvents = (): Record<string, unknown>[] =>
  h.sendToWindow.mock.calls.filter((c) => c[0] === "auth-event").map((c) => c[1]);

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  h.handlers.clear();
  // clearMocks only clears call history — restore the default implementation
  // so per-test overrides can't leak into the next test.
  h.authStorage.login.mockImplementation(() => new Promise(() => {}));
  vi.resetModules();
});

describe("auth_login flow", () => {
  /** Start a login whose settlement the test controls. */
  function startLogin(provider = "prov") {
    let settle!: { resolve: () => void; reject: (e: unknown) => void };
    h.authStorage.login.mockImplementationOnce(
      (_p: string, _cbs: unknown) =>
        new Promise<void>((resolve, reject) => {
          settle = { resolve, reject };
        }),
    );
    invoke("auth_login", { provider });
    const call = h.authStorage.login.mock.calls.at(-1) as unknown[];
    return { callbacks: call[1] as Record<string, (...a: never[]) => unknown> & { signal: AbortSignal }, settle };
  }

  it("should stream the auth url to the renderer and open the browser", async () => {
    await setup();
    const { callbacks } = startLogin();
    callbacks.onAuth({ url: "https://auth.example", instructions: "go" } as never);

    expect(authEvents()).toContainEqual({ type: "auth", url: "https://auth.example", instructions: "go" });
    expect(h.openExternal).toHaveBeenCalledWith("https://auth.example");
  });

  it("should stream progress and device-code events", async () => {
    await setup();
    const { callbacks } = startLogin();
    callbacks.onProgress("working" as never);
    callbacks.onDeviceCode({ userCode: "AB-12", verificationUri: "https://v" } as never);

    expect(authEvents()).toContainEqual({ type: "progress", message: "working" });
    expect(authEvents()).toContainEqual({ type: "device_code", userCode: "AB-12", verificationUri: "https://v" });
  });

  it("should resolve a prompt with the user's answer when the renderer responds", async () => {
    await setup();
    const { callbacks } = startLogin();
    const answer = callbacks.onPrompt({ message: "Enter code", placeholder: "code", allowEmpty: false } as never);

    expect(authEvents()).toContainEqual({
      type: "prompt",
      message: "Enter code",
      placeholder: "code",
      allowEmpty: false,
      id: "q1",
    });
    invoke("auth_login_respond", { id: "q1", value: "sekret" });
    await expect(answer).resolves.toBe("sekret");
  });

  it("should resolve a prompt with an empty string when the renderer responds null", async () => {
    await setup();
    const { callbacks } = startLogin();
    const answer = callbacks.onPrompt({ message: "m" } as never);
    invoke("auth_login_respond", { id: "q1", value: null });
    await expect(answer).resolves.toBe("");
  });

  it("should resolve a select with undefined when the renderer responds with an empty value", async () => {
    await setup();
    const { callbacks } = startLogin();
    const choice = callbacks.onSelect({ message: "pick", options: [{ id: "a", label: "A" }] } as never);
    invoke("auth_login_respond", { id: "q1", value: "" });
    await expect(choice).resolves.toBeUndefined();
  });

  it("should resolve a select with the chosen option id", async () => {
    await setup();
    const { callbacks } = startLogin();
    const choice = callbacks.onSelect({ message: "pick", options: [] } as never);
    invoke("auth_login_respond", { id: "q1", value: "a" });
    await expect(choice).resolves.toBe("a");
  });

  it("should ask for a manual code with an id the renderer can answer", async () => {
    await setup();
    const { callbacks } = startLogin();
    const code = callbacks.onManualCodeInput();
    expect(authEvents()).toContainEqual({ type: "manual_code", id: "q1" });
    invoke("auth_login_respond", { id: "q1", value: "the-code" });
    await expect(code).resolves.toBe("the-code");
  });

  it("should ignore a respond with an unknown id", async () => {
    await setup();
    startLogin();
    expect(() => invoke("auth_login_respond", { id: "nope", value: "x" })).not.toThrow();
  });

  it("should send a done event when the login succeeds", async () => {
    await setup();
    const { settle } = startLogin("github");
    settle.resolve();
    await flush();
    expect(authEvents()).toContainEqual({ type: "done", provider: "github" });
  });

  it("should record the provider connection for analytics when the login succeeds", async () => {
    await setup();
    const { settle } = startLogin("github");
    settle.resolve();
    await flush();
    expect(h.trackProviderConnected).toHaveBeenCalledWith("github", "oauth");
  });

  it("should send an error event with the message when the login fails", async () => {
    await setup();
    const { settle } = startLogin();
    settle.reject(new Error("denied"));
    await flush();
    expect(authEvents()).toContainEqual({ type: "error", message: "denied" });
  });

  it("should not record a provider connection when the login fails", async () => {
    await setup();
    const { settle } = startLogin();
    settle.reject(new Error("denied"));
    await flush();
    expect(h.trackProviderConnected).not.toHaveBeenCalled();
  });

  it("should stringify a non-Error rejection", async () => {
    await setup();
    const { settle } = startLogin();
    settle.reject("oops");
    await flush();
    expect(authEvents()).toContainEqual({ type: "error", message: "oops" });
  });

  it("should abort the login's signal when the renderer cancels", async () => {
    await setup();
    const { callbacks } = startLogin();
    expect(callbacks.signal.aborted).toBe(false);
    invoke("auth_login_cancel");
    expect(callbacks.signal.aborted).toBe(true);
  });

  it("should not throw when no window is available for an event", async () => {
    await setup(() => null);
    const { callbacks } = startLogin();
    expect(() => callbacks.onProgress("working" as never)).not.toThrow();
  });

  it("should abort the previous attempt when a new login starts", async () => {
    await setup();
    const first = startLogin("a");
    startLogin("b");
    expect(first.callbacks.signal.aborted).toBe(true);
  });

  it("should keep the new attempt cancellable when the aborted one settles late", async () => {
    await setup();
    const first = startLogin("a");
    const second = startLogin("b");
    // The aborted first attempt now rejects — this must not clear the second
    // attempt's state.
    first.settle.reject(new Error("aborted"));
    await flush();

    invoke("auth_login_cancel");
    expect(second.callbacks.signal.aborted).toBe(true);
  });

  it("should keep answering the new attempt's prompts when the aborted one settles late", async () => {
    await setup();
    const first = startLogin("a");
    const second = startLogin("b");
    first.settle.reject(new Error("aborted"));
    await flush();

    const answer = second.callbacks.onPrompt({ message: "code?" } as never);
    invoke("auth_login_respond", { id: "q1", value: "42" });
    await expect(answer).resolves.toBe("42");
  });

  it("should not surface the superseded attempt's failure to the renderer", async () => {
    await setup();
    const first = startLogin("a");
    startLogin("b");
    first.settle.reject(new Error("aborted"));
    await flush();

    expect(authEvents()).not.toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("should support a fresh login after the previous one completed", async () => {
    await setup();
    const first = startLogin("a");
    first.settle.resolve();
    await flush();

    const second = startLogin("b");
    second.settle.resolve();
    await flush();
    expect(authEvents()).toContainEqual({ type: "done", provider: "b" });
  });
});
