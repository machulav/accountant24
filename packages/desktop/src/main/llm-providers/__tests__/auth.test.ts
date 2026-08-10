import { beforeEach, describe, expect, it, vi } from "vitest";

// auth.ts wraps two I/O boundaries — Electron IPC and the pi SDK (which owns
// auth.json/models.json). Both are faked; the module's own logic (mapping,
// validation, labeling) runs for real and is driven through the registered IPC
// handlers.
type Handler = (event: unknown, payload?: unknown) => unknown;

type Prompt = { type: string; message?: string };
type Interaction = { prompt: (p: Prompt) => Promise<string>; notify: (e: unknown) => void };

const h = vi.hoisted(() => {
  /** pi's real error for "credential written, snapshot resync failed". */
  class CredentialSynchronizationError extends Error {}
  return {
    CredentialSynchronizationError,
    handlers: new Map<string, Handler>(),
    modelRuntime: {
      getModels: vi.fn<() => unknown[]>(() => []),
      getProviders: vi.fn<() => unknown[]>(() => []),
      getProvider: vi.fn<(p: string) => unknown>((p) => ({ name: p })),
      getProviderAuthStatus: vi.fn<(p: string) => { configured: boolean; source?: string }>(() => ({
        configured: false,
      })),
      getAvailableSnapshot: vi.fn<() => unknown[]>(() => []),
      listCredentials: vi.fn<() => Promise<unknown[]>>(async () => []),
      login: vi.fn<(p: string, t: string, i: Interaction) => Promise<unknown>>(async () => ({ type: "api_key" })),
      logout: vi.fn<(p: string) => Promise<void>>(async () => {}),
    },
    trackProviderConnected: vi.fn(),
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
}));
vi.mock("../../env", () => ({ workspaceDir: () => "/ws" }));
vi.mock("../../analytics", () => ({ trackProviderConnected: h.trackProviderConnected }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: async () => h.modelRuntime },
  CredentialSynchronizationError: h.CredentialSynchronizationError,
}));

/** Import auth.ts fresh and register its handlers. */
async function setup() {
  const { registerAuthIpc } = await import("../auth");
  registerAuthIpc();
}

const invoke = (channel: string, payload?: unknown) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, payload);
};

/** An OAuth-capable provider entry as pi's provider list reports it. */
const oauthProvider = (id: string, name: string) => ({ id, name, auth: { oauth: { name } } });

beforeEach(() => {
  h.handlers.clear();
  // clearMocks only clears call history — restore the default implementations
  // so per-test mockReturnValue overrides can't leak into the next test.
  h.modelRuntime.getModels.mockImplementation(() => []);
  h.modelRuntime.getProviders.mockImplementation(() => []);
  h.modelRuntime.getProvider.mockImplementation((p: string) => ({ name: p }));
  h.modelRuntime.getProviderAuthStatus.mockImplementation(() => ({ configured: false }));
  h.modelRuntime.getAvailableSnapshot.mockImplementation(() => []);
  h.modelRuntime.listCredentials.mockImplementation(async () => []);
  h.modelRuntime.login.mockImplementation(async () => ({ type: "api_key" }));
  h.modelRuntime.logout.mockImplementation(async () => {});
  vi.resetModules();
});

describe("auth_status", () => {
  it("should list unique providers sorted, with configured/oauth/removable flags", async () => {
    h.modelRuntime.getModels.mockReturnValue([
      { provider: "openai" },
      { provider: "anthropic" },
      { provider: "openai" },
    ]);
    h.modelRuntime.getProviderAuthStatus.mockImplementation((p: string) =>
      p === "anthropic" ? { configured: true, source: "stored" } : { configured: false, source: undefined },
    );
    h.modelRuntime.getProvider.mockImplementation((p: string) => ({
      name: p === "anthropic" ? "Anthropic" : "OpenAI",
    }));
    h.modelRuntime.getProviders.mockReturnValue([oauthProvider("anthropic", "Anthropic")]);
    h.modelRuntime.listCredentials.mockResolvedValue([{ providerId: "anthropic", type: "oauth" }]);
    h.modelRuntime.getAvailableSnapshot.mockReturnValue([{}, {}, {}]);
    await setup();

    const status = (await invoke("auth_status")) as {
      type: string;
      providers: Record<string, unknown>[];
      availableModels: number;
      anyConfigured: boolean;
    };
    expect(status.type).toBe("status");
    expect(status.availableModels).toBe(3);
    expect(status.anyConfigured).toBe(true);
    expect(status.providers.map((p) => p.provider)).toEqual(["anthropic", "openai"]);
    expect(status.providers[0]).toMatchObject({
      displayName: "Anthropic",
      configured: true,
      oauth: true,
      removable: true,
      connection: "Subscription",
    });
    expect(status.providers[1]).toMatchObject({ configured: false, oauth: false, removable: false });
    expect(status.providers[1]).not.toHaveProperty("connection");
  });

  it("should capitalize the bare 'ollama' display name", async () => {
    h.modelRuntime.getModels.mockReturnValue([{ provider: "ollama" }]);
    h.modelRuntime.getProvider.mockReturnValue({ name: "ollama" });
    await setup();

    const status = (await invoke("auth_status")) as { providers: { displayName: string }[] };
    expect(status.providers[0].displayName).toBe("Ollama");
  });

  it("should fall back to the provider id when pi reports no provider entry", async () => {
    h.modelRuntime.getModels.mockReturnValue([{ provider: "custom" }]);
    h.modelRuntime.getProvider.mockReturnValue(undefined);
    await setup();

    const status = (await invoke("auth_status")) as { providers: { displayName: string }[] };
    expect(status.providers[0].displayName).toBe("custom");
  });

  it("should mark a provider not removable when its key comes from the environment", async () => {
    h.modelRuntime.getModels.mockReturnValue([{ provider: "openai" }]);
    h.modelRuntime.getProviderAuthStatus.mockReturnValue({ configured: true, source: "environment" });
    await setup();

    const status = (await invoke("auth_status")) as { providers: Record<string, unknown>[] };
    expect(status.providers[0]).toMatchObject({ removable: false, connection: "Environment variable" });
  });

  it.each([
    ["api_key credential", { credential: "api_key", source: "stored", label: "API Key" }],
    ["models.json key", { credential: undefined, source: "models_json_key", label: "Custom (models.json)" }],
    ["models.json command", { credential: undefined, source: "models_json_command", label: "Custom (models.json)" }],
    ["runtime key", { credential: undefined, source: "runtime", label: "Session key" }],
  ])("should label the connection for a %s", async (_name, { credential, source, label }) => {
    h.modelRuntime.getModels.mockReturnValue([{ provider: "p" }]);
    h.modelRuntime.getProviderAuthStatus.mockReturnValue({ configured: true, source });
    h.modelRuntime.listCredentials.mockResolvedValue(credential ? [{ providerId: "p", type: credential }] : []);
    await setup();

    const status = (await invoke("auth_status")) as { providers: { connection?: string }[] };
    expect(status.providers[0].connection).toBe(label);
  });

  it("should leave the connection unlabelled for a source it has no wording for", async () => {
    h.modelRuntime.getModels.mockReturnValue([{ provider: "p" }]);
    h.modelRuntime.getProviderAuthStatus.mockReturnValue({ configured: true, source: "fallback" });
    await setup();

    const status = (await invoke("auth_status")) as { providers: { connection?: string }[] };
    expect(status.providers[0].connection).toBeUndefined();
  });
});

describe("auth_providers", () => {
  it("should return oauth providers and all providers", async () => {
    h.modelRuntime.getProviders.mockReturnValue([oauthProvider("a", "A")]);
    h.modelRuntime.getModels.mockReturnValue([{ provider: "a" }, { provider: "b" }]);
    h.modelRuntime.getProvider.mockImplementation((p: string) => ({ name: p.toUpperCase() }));
    h.modelRuntime.getProviderAuthStatus.mockReturnValue({ configured: false });
    await setup();

    expect(await invoke("auth_providers")).toEqual({
      type: "providers",
      oauth: [{ id: "a", name: "A" }],
      all: [
        { provider: "a", displayName: "A", oauth: true, configured: false },
        { provider: "b", displayName: "B", oauth: false, configured: false },
      ],
    });
  });

  it("should leave a provider without oauth auth out of the oauth list", async () => {
    h.modelRuntime.getProviders.mockReturnValue([{ id: "b", name: "B", auth: { apiKey: { name: "B key" } } }]);
    h.modelRuntime.getModels.mockReturnValue([{ provider: "b" }]);
    await setup();

    const providers = (await invoke("auth_providers")) as { oauth: unknown[]; all: { oauth: boolean }[] };
    expect(providers.oauth).toEqual([]);
    expect(providers.all[0].oauth).toBe(false);
  });
});

describe("auth_models", () => {
  it("should map available models to the renderer shape and drop extra fields", async () => {
    h.modelRuntime.getAvailableSnapshot.mockReturnValue([
      { provider: "p", id: "m", name: "M", reasoning: true, input: ["text"], contextWindow: 100, baseUrl: "secret" },
    ]);
    await setup();

    expect(await invoke("auth_models")).toEqual({
      type: "models",
      models: [{ provider: "p", id: "m", name: "M", reasoning: true, input: ["text"], contextWindow: 100 }],
    });
  });
});

describe("auth_set_key", () => {
  it("should return an error when the provider is missing", async () => {
    await setup();
    expect(await invoke("auth_set_key", { provider: "", key: "k" })).toEqual({
      type: "error",
      message: "missing provider",
    });
    expect(h.modelRuntime.login).not.toHaveBeenCalled();
  });

  it("should return an error when the key is only whitespace", async () => {
    await setup();
    expect(await invoke("auth_set_key", { provider: "p", key: "   " })).toEqual({
      type: "error",
      message: "empty API key",
    });
  });

  it("should store the trimmed key when provider and key are valid", async () => {
    await setup();
    expect(await invoke("auth_set_key", { provider: "p", key: "  sk-1  " })).toEqual({ type: "done", provider: "p" });
    expect(h.modelRuntime.login).toHaveBeenCalledWith("p", "api_key", expect.anything());
  });

  it("should answer the provider's secret prompt with the trimmed key", async () => {
    let answered: string | undefined;
    h.modelRuntime.login.mockImplementation(async (_provider, _type, interaction) => {
      answered = await interaction.prompt({ type: "secret", message: "API key" });
      return { type: "api_key", key: answered };
    });
    await setup();

    await invoke("auth_set_key", { provider: "p", key: "  sk-1  " });
    expect(answered).toBe("sk-1");
  });

  it("should ignore progress the provider reports while storing the key", async () => {
    h.modelRuntime.login.mockImplementation(async (_provider, _type, interaction) => {
      interaction.notify({ type: "progress", message: "Verifying key..." });
      await interaction.prompt({ type: "secret", message: "API key" });
      return { type: "api_key" };
    });
    await setup();

    expect(await invoke("auth_set_key", { provider: "p", key: "sk-1" })).toEqual({ type: "done", provider: "p" });
  });

  it("should fail when the provider asks for more than the key", async () => {
    h.modelRuntime.login.mockImplementation(async (_provider, _type, interaction) => {
      await interaction.prompt({ type: "secret", message: "API key" });
      // e.g. Cloudflare, which also wants an account id.
      await interaction.prompt({ type: "text", message: "Account id" });
      return { type: "api_key" };
    });
    await setup();

    expect(await invoke("auth_set_key", { provider: "p", key: "sk-1" })).toEqual({
      type: "error",
      message: "This provider needs more than an API key to connect.",
    });
    expect(h.trackProviderConnected).not.toHaveBeenCalled();
  });

  it("should report the failure when the provider rejects the key", async () => {
    h.modelRuntime.login.mockRejectedValue(new Error("Unknown provider: nope"));
    await setup();

    expect(await invoke("auth_set_key", { provider: "nope", key: "sk-1" })).toEqual({
      type: "error",
      message: "Unknown provider: nope",
    });
  });

  it("should record the provider connection for analytics when the key is stored", async () => {
    await setup();
    await invoke("auth_set_key", { provider: "p", key: "sk-1" });
    expect(h.trackProviderConnected).toHaveBeenCalledWith("p", "api_key");
  });

  it("should not record a provider connection when the key is rejected", async () => {
    await setup();
    await invoke("auth_set_key", { provider: "", key: "k" });
    await invoke("auth_set_key", { provider: "p", key: "   " });
    expect(h.trackProviderConnected).not.toHaveBeenCalled();
  });
});

describe("auth_logout", () => {
  it("should return an error when the provider is missing", async () => {
    await setup();
    expect(await invoke("auth_logout", { provider: "" })).toEqual({ type: "error", message: "missing provider" });
  });

  it("should log the provider out when it is given", async () => {
    await setup();
    expect(await invoke("auth_logout", { provider: "p" })).toEqual({ type: "done", provider: "p" });
    expect(h.modelRuntime.logout).toHaveBeenCalledWith("p");
  });

  it("should still report success when only the credential resync fails", async () => {
    h.modelRuntime.logout.mockRejectedValue(new h.CredentialSynchronizationError("resync failed"));
    await setup();

    expect(await invoke("auth_logout", { provider: "p" })).toEqual({ type: "done", provider: "p" });
  });

  it("should report the failure when the credential cannot be deleted", async () => {
    h.modelRuntime.logout.mockRejectedValue(new Error("auth.json is locked"));
    await setup();

    expect(await invoke("auth_logout", { provider: "p" })).toEqual({
      type: "error",
      message: "auth.json is locked",
    });
  });
});
