import { beforeEach, describe, expect, it, vi } from "vitest";

// auth.ts wraps two I/O boundaries — Electron IPC and the pi SDK (which owns
// auth.json/models.json). Both are faked; the module's own logic (mapping,
// validation, labeling) runs for real and is driven through the registered IPC
// handlers.
type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  authStorage: {
    get: vi.fn<(provider: string) => unknown>(),
    getOAuthProviders: vi.fn<() => unknown[]>(() => []),
    set: vi.fn(),
    logout: vi.fn(),
  },
  modelRegistry: {
    getAll: vi.fn<() => unknown[]>(() => []),
    getAvailable: vi.fn<() => unknown[]>(() => []),
    getProviderAuthStatus: vi.fn<(p: string) => { configured: boolean; source?: string }>(() => ({
      configured: false,
    })),
    getProviderDisplayName: vi.fn<(p: string) => string>((p) => p),
  },
  trackProviderConnected: vi.fn(),
}));

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
  AuthStorage: { create: () => h.authStorage },
  ModelRegistry: { create: () => h.modelRegistry },
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

beforeEach(() => {
  h.handlers.clear();
  // clearMocks only clears call history — restore the default implementations
  // so per-test mockReturnValue overrides can't leak into the next test.
  h.authStorage.get.mockImplementation(() => undefined);
  h.authStorage.getOAuthProviders.mockImplementation(() => []);
  h.modelRegistry.getAll.mockImplementation(() => []);
  h.modelRegistry.getAvailable.mockImplementation(() => []);
  h.modelRegistry.getProviderAuthStatus.mockImplementation(() => ({ configured: false }));
  h.modelRegistry.getProviderDisplayName.mockImplementation((p: string) => p);
  vi.resetModules();
});

describe("auth_status", () => {
  it("should list unique providers sorted, with configured/oauth/removable flags", async () => {
    h.modelRegistry.getAll.mockReturnValue([{ provider: "openai" }, { provider: "anthropic" }, { provider: "openai" }]);
    h.modelRegistry.getProviderAuthStatus.mockImplementation((p: string) =>
      p === "anthropic" ? { configured: true, source: "stored" } : { configured: false, source: undefined },
    );
    h.modelRegistry.getProviderDisplayName.mockImplementation((p: string) =>
      p === "anthropic" ? "Anthropic" : "OpenAI",
    );
    h.authStorage.getOAuthProviders.mockReturnValue([{ id: "anthropic", name: "Anthropic", usesCallbackServer: true }]);
    h.authStorage.get.mockImplementation((p: string) => (p === "anthropic" ? { type: "oauth" } : undefined));
    h.modelRegistry.getAvailable.mockReturnValue([{}, {}, {}]);
    await setup();

    const status = invoke("auth_status") as {
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
    h.modelRegistry.getAll.mockReturnValue([{ provider: "ollama" }]);
    h.modelRegistry.getProviderDisplayName.mockReturnValue("ollama");
    await setup();

    const status = invoke("auth_status") as { providers: { displayName: string }[] };
    expect(status.providers[0].displayName).toBe("Ollama");
  });

  it("should mark a provider not removable when its key comes from the environment", async () => {
    h.modelRegistry.getAll.mockReturnValue([{ provider: "openai" }]);
    h.modelRegistry.getProviderAuthStatus.mockReturnValue({ configured: true, source: "environment" });
    await setup();

    const status = invoke("auth_status") as { providers: Record<string, unknown>[] };
    expect(status.providers[0]).toMatchObject({ removable: false, connection: "Environment variable" });
  });

  it.each([
    ["api_key credential", { cred: { type: "api_key" }, source: "stored", label: "API Key" }],
    ["models.json key", { cred: undefined, source: "models_json_key", label: "Custom (models.json)" }],
    ["models.json command", { cred: undefined, source: "models_json_command", label: "Custom (models.json)" }],
    ["runtime key", { cred: undefined, source: "runtime", label: "Session key" }],
  ])("should label the connection for a %s", async (_name, { cred, source, label }) => {
    h.modelRegistry.getAll.mockReturnValue([{ provider: "p" }]);
    h.modelRegistry.getProviderAuthStatus.mockReturnValue({ configured: true, source });
    h.authStorage.get.mockReturnValue(cred);
    await setup();

    const status = invoke("auth_status") as { providers: { connection?: string }[] };
    expect(status.providers[0].connection).toBe(label);
  });
});

describe("auth_providers", () => {
  it("should return oauth providers with coerced usesCallbackServer and all providers", async () => {
    h.authStorage.getOAuthProviders.mockReturnValue([{ id: "a", name: "A", usesCallbackServer: undefined }]);
    h.modelRegistry.getAll.mockReturnValue([{ provider: "a" }, { provider: "b" }]);
    h.modelRegistry.getProviderDisplayName.mockImplementation((p: string) => p.toUpperCase());
    h.modelRegistry.getProviderAuthStatus.mockReturnValue({ configured: false });
    await setup();

    expect(invoke("auth_providers")).toEqual({
      type: "providers",
      oauth: [{ id: "a", name: "A", usesCallbackServer: false }],
      all: [
        { provider: "a", displayName: "A", oauth: true, configured: false },
        { provider: "b", displayName: "B", oauth: false, configured: false },
      ],
    });
  });
});

describe("auth_models", () => {
  it("should map available models to the renderer shape and drop extra fields", async () => {
    h.modelRegistry.getAvailable.mockReturnValue([
      { provider: "p", id: "m", name: "M", reasoning: true, input: ["text"], contextWindow: 100, baseUrl: "secret" },
    ]);
    await setup();

    expect(invoke("auth_models")).toEqual({
      type: "models",
      models: [{ provider: "p", id: "m", name: "M", reasoning: true, input: ["text"], contextWindow: 100 }],
    });
  });
});

describe("auth_set_key", () => {
  it("should return an error when the provider is missing", async () => {
    await setup();
    expect(invoke("auth_set_key", { provider: "", key: "k" })).toEqual({ type: "error", message: "missing provider" });
    expect(h.authStorage.set).not.toHaveBeenCalled();
  });

  it("should return an error when the key is only whitespace", async () => {
    await setup();
    expect(invoke("auth_set_key", { provider: "p", key: "   " })).toEqual({ type: "error", message: "empty API key" });
  });

  it("should store the trimmed key when provider and key are valid", async () => {
    await setup();
    expect(invoke("auth_set_key", { provider: "p", key: "  sk-1  " })).toEqual({ type: "done", provider: "p" });
    expect(h.authStorage.set).toHaveBeenCalledWith("p", { type: "api_key", key: "sk-1" });
  });

  it("should record the provider connection for analytics when the key is stored", async () => {
    await setup();
    invoke("auth_set_key", { provider: "p", key: "sk-1" });
    expect(h.trackProviderConnected).toHaveBeenCalledWith("p", "api_key");
  });

  it("should not record a provider connection when the key is rejected", async () => {
    await setup();
    invoke("auth_set_key", { provider: "", key: "k" });
    invoke("auth_set_key", { provider: "p", key: "   " });
    expect(h.trackProviderConnected).not.toHaveBeenCalled();
  });
});

describe("auth_logout", () => {
  it("should return an error when the provider is missing", async () => {
    await setup();
    expect(invoke("auth_logout", { provider: "" })).toEqual({ type: "error", message: "missing provider" });
  });

  it("should log the provider out when it is given", async () => {
    await setup();
    expect(invoke("auth_logout", { provider: "p" })).toEqual({ type: "done", provider: "p" });
    expect(h.authStorage.logout).toHaveBeenCalledWith("p");
  });
});
