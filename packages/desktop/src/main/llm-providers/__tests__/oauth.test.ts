import { beforeEach, describe, expect, it, vi } from "vitest";

// oauth.ts wraps two I/O boundaries — Electron IPC/shell and the pi SDK login.
// Both are faked; the login handshake (attempt state, prompt correlation,
// supersession) runs for real, driven through the registered IPC handlers.
type Handler = (event: unknown, payload?: unknown) => unknown;

/** pi's login interaction, as oauth.ts hands it to ModelRuntime.login(). */
interface Interaction {
  signal: AbortSignal;
  notify: (event: Record<string, unknown>) => void;
  prompt: (prompt: Record<string, unknown>) => Promise<string>;
}

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sendToWindow: vi.fn(),
  openExternal: vi.fn(async () => {}),
  modelRuntime: {
    login: vi.fn<(provider: string, type: string, interaction: Interaction) => Promise<void>>(
      () => new Promise(() => {}),
    ),
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
  ModelRuntime: { create: async () => h.modelRuntime },
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
  h.modelRuntime.login.mockImplementation(() => new Promise(() => {}));
  h.openExternal.mockImplementation(async () => {});
  vi.resetModules();
});

describe("auth_login flow", () => {
  /** Start a login whose settlement the test controls. The runtime is built
   *  asynchronously, so the flush is what lets login() be reached. */
  async function startLogin(provider = "prov") {
    let settle!: { resolve: () => void; reject: (e: unknown) => void };
    h.modelRuntime.login.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          settle = { resolve, reject };
        }),
    );
    invoke("auth_login", { provider });
    await flush();
    const call = h.modelRuntime.login.mock.calls.at(-1) as [string, string, Interaction];
    return { provider: call[0], type: call[1], interaction: call[2], settle };
  }

  it("should sign in with the provider's oauth flow", async () => {
    await setup();
    const { provider, type } = await startLogin("github");
    expect(provider).toBe("github");
    expect(type).toBe("oauth");
  });

  it("should stream the auth url to the renderer and open the browser", async () => {
    await setup();
    const { interaction } = await startLogin();
    interaction.notify({ type: "auth_url", url: "https://auth.example", instructions: "go" });

    expect(authEvents()).toContainEqual({ type: "auth", url: "https://auth.example", instructions: "go" });
    expect(h.openExternal).toHaveBeenCalledWith("https://auth.example");
  });

  it("should still show the auth url when the browser cannot be opened", async () => {
    h.openExternal.mockRejectedValue(new Error("no browser"));
    await setup();
    const { interaction } = await startLogin();
    interaction.notify({ type: "auth_url", url: "https://auth.example" });
    await flush();

    // The renderer keeps the link as a manual fallback, and the failure to open
    // a browser must not end the sign-in.
    expect(authEvents()).toContainEqual({ type: "auth", url: "https://auth.example", instructions: undefined });
    expect(authEvents()).not.toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("should stream progress and device-code events", async () => {
    await setup();
    const { interaction } = await startLogin();
    interaction.notify({ type: "progress", message: "working" });
    interaction.notify({ type: "device_code", userCode: "AB-12", verificationUri: "https://v" });

    expect(authEvents()).toContainEqual({ type: "progress", message: "working" });
    expect(authEvents()).toContainEqual({ type: "device_code", userCode: "AB-12", verificationUri: "https://v" });
  });

  it("should stream an informational notice as progress", async () => {
    await setup();
    const { interaction } = await startLogin();
    interaction.notify({ type: "info", message: "Use a work account", links: [{ url: "https://docs" }] });

    expect(authEvents()).toContainEqual({ type: "progress", message: "Use a work account" });
  });

  it("should resolve a prompt with the user's answer when the renderer responds", async () => {
    await setup();
    const { interaction } = await startLogin();
    const answer = interaction.prompt({ type: "secret", message: "Enter code", placeholder: "code" });

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

  it("should let a free-text question be answered blank", async () => {
    await setup();
    const { interaction } = await startLogin();
    // pi asks this way for the GitHub Enterprise domain, where blank means
    // "use github.com".
    const answer = interaction.prompt({ type: "text", message: "Domain (blank for github.com)" });

    expect(authEvents()).toContainEqual(expect.objectContaining({ type: "prompt", allowEmpty: true, id: "q1" }));
    invoke("auth_login_respond", { id: "q1", value: "" });
    await expect(answer).resolves.toBe("");
  });

  it("should resolve a prompt with an empty string when the renderer responds null", async () => {
    await setup();
    const { interaction } = await startLogin();
    const answer = interaction.prompt({ type: "text", message: "m" });
    invoke("auth_login_respond", { id: "q1", value: null });
    await expect(answer).resolves.toBe("");
  });

  it("should cancel the login when the renderer dismisses a select", async () => {
    await setup();
    const { interaction } = await startLogin();
    const choice = interaction.prompt({ type: "select", message: "pick", options: [{ id: "a", label: "A" }] });
    invoke("auth_login_respond", { id: "q1", value: "" });
    await expect(choice).rejects.toThrow("Login cancelled");
  });

  it("should resolve a select with the chosen option id", async () => {
    await setup();
    const { interaction } = await startLogin();
    const choice = interaction.prompt({ type: "select", message: "pick", options: [] });
    invoke("auth_login_respond", { id: "q1", value: "a" });
    await expect(choice).resolves.toBe("a");
  });

  it("should send a select's options without pi's extra description field", async () => {
    await setup();
    const { interaction } = await startLogin();
    void interaction.prompt({
      type: "select",
      message: "pick",
      options: [{ id: "a", label: "A", description: "the first one" }],
    });

    expect(authEvents()).toContainEqual({
      type: "select",
      message: "pick",
      options: [{ id: "a", label: "A" }],
      id: "q1",
    });
  });

  it("should ask for a manual code with an id the renderer can answer", async () => {
    await setup();
    const { interaction } = await startLogin();
    const code = interaction.prompt({ type: "manual_code", message: "Paste it" });
    expect(authEvents()).toContainEqual({ type: "manual_code", id: "q1" });
    invoke("auth_login_respond", { id: "q1", value: "the-code" });
    await expect(code).resolves.toBe("the-code");
  });

  it("should drop a question pi retracts before the user answers", async () => {
    await setup();
    const { interaction } = await startLogin();
    // pi races the pasted-code question against the browser callback and
    // retracts it when the callback wins.
    const retract = new AbortController();
    const code = interaction.prompt({ type: "manual_code", message: "Paste it", signal: retract.signal });
    retract.abort();
    await expect(code).rejects.toThrow("Prompt cancelled");

    // A late answer to the retracted question must not resolve anything.
    expect(() => invoke("auth_login_respond", { id: "q1", value: "too-late" })).not.toThrow();
  });

  it("should refuse a question that arrives already retracted", async () => {
    await setup();
    const { interaction } = await startLogin();
    const code = interaction.prompt({ type: "manual_code", message: "Paste it", signal: AbortSignal.abort() });
    await expect(code).rejects.toThrow("Prompt cancelled");
    expect(authEvents()).not.toContainEqual(expect.objectContaining({ type: "manual_code" }));
  });

  it("should ignore a respond with an unknown id", async () => {
    await setup();
    await startLogin();
    expect(() => invoke("auth_login_respond", { id: "nope", value: "x" })).not.toThrow();
  });

  it("should send a done event when the login succeeds", async () => {
    await setup();
    const { settle } = await startLogin("github");
    settle.resolve();
    await flush();
    expect(authEvents()).toContainEqual({ type: "done", provider: "github" });
  });

  it("should record the provider connection for analytics when the login succeeds", async () => {
    await setup();
    const { settle } = await startLogin("github");
    settle.resolve();
    await flush();
    expect(h.trackProviderConnected).toHaveBeenCalledWith("github", "oauth");
  });

  it("should send an error event with the message when the login fails", async () => {
    await setup();
    const { settle } = await startLogin();
    settle.reject(new Error("denied"));
    await flush();
    expect(authEvents()).toContainEqual({ type: "error", message: "denied" });
  });

  it("should not record a provider connection when the login fails", async () => {
    await setup();
    const { settle } = await startLogin();
    settle.reject(new Error("denied"));
    await flush();
    expect(h.trackProviderConnected).not.toHaveBeenCalled();
  });

  it("should stringify a non-Error rejection", async () => {
    await setup();
    const { settle } = await startLogin();
    settle.reject("oops");
    await flush();
    expect(authEvents()).toContainEqual({ type: "error", message: "oops" });
  });

  it("should abort the login's signal when the renderer cancels", async () => {
    await setup();
    const { interaction } = await startLogin();
    expect(interaction.signal.aborted).toBe(false);
    invoke("auth_login_cancel");
    expect(interaction.signal.aborted).toBe(true);
  });

  it("should not throw when no window is available for an event", async () => {
    await setup(() => null);
    const { interaction } = await startLogin();
    expect(() => interaction.notify({ type: "progress", message: "working" })).not.toThrow();
  });

  it("should abort the previous attempt when a new login starts", async () => {
    await setup();
    const first = await startLogin("a");
    await startLogin("b");
    expect(first.interaction.signal.aborted).toBe(true);
  });

  it("should keep the new attempt cancellable when the aborted one settles late", async () => {
    await setup();
    const first = await startLogin("a");
    const second = await startLogin("b");
    // The aborted first attempt now rejects — this must not clear the second
    // attempt's state.
    first.settle.reject(new Error("aborted"));
    await flush();

    invoke("auth_login_cancel");
    expect(second.interaction.signal.aborted).toBe(true);
  });

  it("should keep answering the new attempt's prompts when the aborted one settles late", async () => {
    await setup();
    const first = await startLogin("a");
    const second = await startLogin("b");
    first.settle.reject(new Error("aborted"));
    await flush();

    const answer = second.interaction.prompt({ type: "text", message: "code?" });
    invoke("auth_login_respond", { id: "q1", value: "42" });
    await expect(answer).resolves.toBe("42");
  });

  it("should not surface the superseded attempt's failure to the renderer", async () => {
    await setup();
    const first = await startLogin("a");
    await startLogin("b");
    first.settle.reject(new Error("aborted"));
    await flush();

    expect(authEvents()).not.toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("should support a fresh login after the previous one completed", async () => {
    await setup();
    const first = await startLogin("a");
    first.settle.resolve();
    await flush();

    const second = await startLogin("b");
    second.settle.resolve();
    await flush();
    expect(authEvents()).toContainEqual({ type: "done", provider: "b" });
  });
});
