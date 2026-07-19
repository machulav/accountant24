import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pi.ts wraps three I/O boundaries — Electron IPC/shell, the pi SDK (which owns
// auth.json/models.json), and node:fs + fetch (Ollama). All four are faked; the
// module's own logic (mapping, validation, merge, containment, login handshake)
// runs for real and is driven through the registered IPC handlers.
type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sendToWindow: vi.fn(),
  openExternal: vi.fn(async () => {}),
  authStorage: {
    get: vi.fn<(provider: string) => unknown>(),
    getOAuthProviders: vi.fn<() => unknown[]>(() => []),
    set: vi.fn(),
    logout: vi.fn(),
    login: vi.fn<(provider: string, callbacks: unknown) => Promise<void>>(() => new Promise(() => {})),
  },
  modelRegistry: {
    getAll: vi.fn<() => unknown[]>(() => []),
    getAvailable: vi.fn<() => unknown[]>(() => []),
    getProviderAuthStatus: vi.fn<(p: string) => { configured: boolean; source?: string }>(() => ({
      configured: false,
    })),
    getProviderDisplayName: vi.fn<(p: string) => string>((p) => p),
  },
  sessionList: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  trackProviderConnected: vi.fn(),
  killSessionAgent: vi.fn(),
  fs: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
  shell: { openExternal: h.openExternal },
}));
vi.mock("../env", () => ({ workspaceDir: () => "/ws", sessionsDir: () => "/ws/sessions" }));
vi.mock("../agent", () => ({ killSessionAgent: h.killSessionAgent }));
vi.mock("../analytics", () => ({ trackProviderConnected: h.trackProviderConnected }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  AuthStorage: { create: () => h.authStorage },
  ModelRegistry: { create: () => h.modelRegistry },
  SessionManager: { list: (...args: unknown[]) => h.sessionList(...args) },
}));
vi.mock("node:fs", () => ({
  existsSync: h.fs.existsSync,
  readFileSync: h.fs.readFileSync,
  writeFileSync: h.fs.writeFileSync,
  rmSync: h.fs.rmSync,
}));

const win = { isDestroyed: () => false, webContents: { send: h.sendToWindow } };

/** Import pi.ts fresh (module-level login state) and register its handlers. */
async function setup(getWin: () => unknown = () => win) {
  const { registerPiIpc } = await import("../pi");
  registerPiIpc(getWin as never);
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

/** Minimal fetch Response stub. */
const jsonResponse = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

/** The JSON object written by the nth writeFileSync call. */
const writtenJson = (n = 0): Record<string, unknown> => JSON.parse(h.fs.writeFileSync.mock.calls[n][1] as string);

beforeEach(() => {
  h.handlers.clear();
  // clearMocks only clears call history — restore the default implementations
  // so per-test mockReturnValue overrides can't leak into the next test.
  h.authStorage.login.mockImplementation(() => new Promise(() => {}));
  h.authStorage.get.mockImplementation(() => undefined);
  h.authStorage.getOAuthProviders.mockImplementation(() => []);
  h.modelRegistry.getAll.mockImplementation(() => []);
  h.modelRegistry.getAvailable.mockImplementation(() => []);
  h.modelRegistry.getProviderAuthStatus.mockImplementation(() => ({ configured: false }));
  h.modelRegistry.getProviderDisplayName.mockImplementation((p: string) => p);
  h.sessionList.mockImplementation(async () => []);
  h.fs.existsSync.mockImplementation(() => false);
  h.fs.readFileSync.mockImplementation(() => "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network unavailable");
    }),
  );
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe("auth_detect_ollama", () => {
  it("should report running with the installed model names when the tags endpoint answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ models: [{ name: "llama3" }, {}, { name: "qwen" }] })),
    );
    await setup();

    await expect(invoke("auth_detect_ollama")).resolves.toEqual({
      type: "ollama",
      running: true,
      models: ["llama3", "qwen"],
    });
  });

  it("should report not running when the endpoint returns an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, false)),
    );
    await setup();

    await expect(invoke("auth_detect_ollama")).resolves.toEqual({ type: "ollama", running: false, models: [] });
  });

  it("should report not running when the fetch throws", async () => {
    await setup();
    await expect(invoke("auth_detect_ollama")).resolves.toEqual({ type: "ollama", running: false, models: [] });
  });
});

describe("auth_add_ollama", () => {
  it("should return an error when the model is missing", async () => {
    await setup();
    await expect(invoke("auth_add_ollama", { model: "" })).resolves.toEqual({
      type: "error",
      message: "missing model",
    });
  });

  it("should create models.json with the Ollama provider defaults when none exists", async () => {
    await setup();
    await expect(invoke("auth_add_ollama", { model: "llama3" })).resolves.toEqual({
      type: "done",
      provider: "ollama",
      count: 1,
    });

    expect(h.fs.writeFileSync.mock.calls[0][0]).toBe("/ws/models.json");
    expect(writtenJson()).toEqual({
      providers: {
        ollama: {
          name: "Ollama",
          baseUrl: "http://localhost:11434/v1",
          api: "openai-completions",
          apiKey: "ollama",
          models: [{ id: "llama3", name: "llama3" }],
        },
      },
    });
  });

  it("should preserve existing provider fields and other providers when merging", async () => {
    h.fs.existsSync.mockReturnValue(true);
    h.fs.readFileSync.mockReturnValue(
      JSON.stringify({
        providers: {
          custom: { name: "Custom" },
          ollama: { baseUrl: "http://other:1234/v1", models: [{ id: "m1", name: "m1" }] },
        },
      }),
    );
    await setup();
    await invoke("auth_add_ollama", { model: "m2" });

    const config = writtenJson() as { providers: Record<string, { baseUrl?: string; models?: unknown[] }> };
    expect(config.providers.custom).toEqual({ name: "Custom" });
    expect(config.providers.ollama.baseUrl).toBe("http://other:1234/v1");
    expect(config.providers.ollama.models).toEqual([
      { id: "m1", name: "m1" },
      { id: "m2", name: "m2" },
    ]);
  });

  it("should not duplicate a model that is already registered", async () => {
    h.fs.existsSync.mockReturnValue(true);
    h.fs.readFileSync.mockReturnValue(
      JSON.stringify({ providers: { ollama: { models: [{ id: "m1", name: "m1" }] } } }),
    );
    await setup();
    await invoke("auth_add_ollama", { model: "m1" });

    const config = writtenJson() as { providers: { ollama: { models: unknown[] } } };
    expect(config.providers.ollama.models).toEqual([{ id: "m1", name: "m1" }]);
  });

  it("should refuse to overwrite models.json when it is not valid JSON", async () => {
    h.fs.existsSync.mockReturnValue(true);
    h.fs.readFileSync.mockReturnValue("{oops");
    await setup();

    await expect(invoke("auth_add_ollama", { model: "m" })).resolves.toEqual({
      type: "error",
      message: "models.json is not valid JSON; refusing to overwrite",
    });
    expect(h.fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("should record the Ollama connection for analytics when the model is registered", async () => {
    await setup();
    await invoke("auth_add_ollama", { model: "llama3" });
    expect(h.trackProviderConnected).toHaveBeenCalledWith("ollama", "ollama");
  });

  it("should not record a connection when models.json is invalid", async () => {
    h.fs.existsSync.mockReturnValue(true);
    h.fs.readFileSync.mockReturnValue("{oops");
    await setup();
    await invoke("auth_add_ollama", { model: "m" });
    expect(h.trackProviderConnected).not.toHaveBeenCalled();
  });
});

describe("auth_add_ollama context baking", () => {
  /** Stub /api/show with the given trained max and record /api/create bodies. */
  function stubOllama(contextLength: number | undefined) {
    const created: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (String(url).endsWith("/api/show")) {
          if (contextLength === undefined) return jsonResponse({}, false);
          return jsonResponse({ model_info: { "llama.context_length": contextLength } });
        }
        if (String(url).endsWith("/api/create")) {
          created.push(JSON.parse(init?.body ?? "{}"));
          return jsonResponse({});
        }
        return jsonResponse({});
      }),
    );
    return created;
  }

  it("should bake the trained max when it is below the 32768 target", async () => {
    const created = stubOllama(8192);
    await setup();
    await invoke("auth_add_ollama", { model: "m" });
    expect(created).toEqual([{ model: "m", from: "m", parameters: { num_ctx: 8192 } }]);
  });

  it("should cap the baked context at 32768 when the trained max is larger", async () => {
    const created = stubOllama(200000);
    await setup();
    await invoke("auth_add_ollama", { model: "m" });
    expect(created).toEqual([{ model: "m", from: "m", parameters: { num_ctx: 32768 } }]);
  });

  it("should not re-create the model when its trained max is 4096 or less", async () => {
    const created = stubOllama(4096);
    await setup();
    await invoke("auth_add_ollama", { model: "m" });
    expect(created).toEqual([]);
  });

  it("should bake 4097 when the trained max is just above Ollama's default", async () => {
    const created = stubOllama(4097);
    await setup();
    await invoke("auth_add_ollama", { model: "m" });
    expect(created).toEqual([{ model: "m", from: "m", parameters: { num_ctx: 4097 } }]);
  });

  it("should fall back to the 32768 target when the trained max is not discoverable", async () => {
    const created = stubOllama(undefined);
    await setup();
    await invoke("auth_add_ollama", { model: "m" });
    expect(created).toEqual([{ model: "m", from: "m", parameters: { num_ctx: 32768 } }]);
  });
});

describe("auth_add_all_ollama", () => {
  it("should return an error when Ollama is not running", async () => {
    await setup();
    await expect(invoke("auth_add_all_ollama")).resolves.toEqual({ type: "error", message: "Ollama isn’t running." });
  });

  it("should return an error when Ollama is running with no models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ models: [] })),
    );
    await setup();
    await expect(invoke("auth_add_all_ollama")).resolves.toEqual({
      type: "error",
      message: "Ollama is running but has no models. Pull one with `ollama pull`.",
    });
  });

  it("should register every installed model when Ollama is running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/api/tags")) return jsonResponse({ models: [{ name: "a" }, { name: "b" }] });
        return jsonResponse({}, false);
      }),
    );
    await setup();

    await expect(invoke("auth_add_all_ollama")).resolves.toEqual({ type: "done", provider: "ollama", count: 2 });
    const config = writtenJson() as { providers: { ollama: { models: unknown[] } } };
    expect(config.providers.ollama.models).toEqual([
      { id: "a", name: "a" },
      { id: "b", name: "b" },
    ]);
  });
});

describe("auth_remove_ollama", () => {
  it("should succeed without touching anything when models.json does not exist", async () => {
    await setup();
    expect(invoke("auth_remove_ollama")).toEqual({ type: "done", provider: "ollama" });
    expect(h.fs.writeFileSync).not.toHaveBeenCalled();
    expect(h.authStorage.logout).not.toHaveBeenCalled();
  });

  it("should refuse when models.json is not valid JSON", async () => {
    h.fs.existsSync.mockReturnValue(true);
    h.fs.readFileSync.mockReturnValue("{oops");
    await setup();
    expect(invoke("auth_remove_ollama")).toEqual({
      type: "error",
      message: "models.json is not valid JSON; refusing to overwrite",
    });
  });

  it("should remove only the ollama provider and keep others", async () => {
    h.fs.existsSync.mockReturnValue(true);
    h.fs.readFileSync.mockReturnValue(
      JSON.stringify({ providers: { ollama: { name: "Ollama" }, keep: { name: "K" } } }),
    );
    await setup();

    expect(invoke("auth_remove_ollama")).toEqual({ type: "done", provider: "ollama" });
    expect(writtenJson()).toEqual({ providers: { keep: { name: "K" } } });
    expect(h.authStorage.logout).toHaveBeenCalledWith("ollama");
  });

  it("should not rewrite models.json when it has no ollama provider", async () => {
    h.fs.existsSync.mockReturnValue(true);
    h.fs.readFileSync.mockReturnValue(JSON.stringify({ providers: { keep: {} } }));
    await setup();

    invoke("auth_remove_ollama");
    expect(h.fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("sessions_list", () => {
  it("should map session infos, defaulting name/firstMessage and ISO-formatting dates", async () => {
    h.sessionList.mockResolvedValue([
      {
        path: "/ws/sessions/s1.jsonl",
        id: "s1",
        name: undefined,
        firstMessage: undefined,
        messageCount: 3,
        modified: new Date("2026-01-02T03:04:05Z"),
      },
    ]);
    await setup();

    await expect(invoke("sessions_list")).resolves.toEqual({
      type: "sessions",
      sessions: [
        {
          path: "/ws/sessions/s1.jsonl",
          id: "s1",
          name: "",
          firstMessage: "",
          messageCount: 3,
          modified: "2026-01-02T03:04:05.000Z",
        },
      ],
    });
    expect(h.sessionList).toHaveBeenCalledWith("/ws", "/ws/sessions");
  });

  it("should stringify a non-Date modified value", async () => {
    h.sessionList.mockResolvedValue([
      { path: "p", id: "i", name: "n", firstMessage: "f", messageCount: 0, modified: 1234 },
    ]);
    await setup();

    const result = (await invoke("sessions_list")) as { sessions: { modified: string }[] };
    expect(result.sessions[0].modified).toBe("1234");
  });
});

describe("sessions_delete", () => {
  const refusal = { type: "error", message: "refusing to delete a path outside the sessions directory" };

  it("should return an error when the path is empty", async () => {
    await setup();
    expect(invoke("sessions_delete", { path: "" })).toEqual({ type: "error", message: "session path is required" });
  });

  it("should delete a file inside the sessions directory", async () => {
    await setup();
    expect(invoke("sessions_delete", { path: "/ws/sessions/a.jsonl" })).toEqual({
      type: "done",
      path: "/ws/sessions/a.jsonl",
    });
    expect(h.fs.rmSync).toHaveBeenCalledWith("/ws/sessions/a.jsonl", { force: true });
  });

  it("should kill the session's agent child before removing the file", async () => {
    await setup();
    invoke("sessions_delete", { path: "/ws/sessions/a.jsonl" });
    expect(h.killSessionAgent).toHaveBeenCalledWith("/ws/sessions/a.jsonl");
    // Kill first, then remove — a live child could re-persist the file.
    const killOrder = h.killSessionAgent.mock.invocationCallOrder[0];
    const rmOrder = h.fs.rmSync.mock.invocationCallOrder[0];
    expect(killOrder).toBeLessThan(rmOrder);
  });

  it("should refuse a sibling directory that shares the sessions prefix", async () => {
    await setup();
    expect(invoke("sessions_delete", { path: "/ws/sessions-backup/x.jsonl" })).toEqual(refusal);
    expect(h.fs.rmSync).not.toHaveBeenCalled();
    expect(h.killSessionAgent).not.toHaveBeenCalled();
  });

  it("should refuse a traversal that resolves outside the sessions directory", async () => {
    await setup();
    expect(invoke("sessions_delete", { path: "/ws/sessions/../auth.json" })).toEqual(refusal);
    expect(h.fs.rmSync).not.toHaveBeenCalled();
  });

  it("should refuse an unrelated absolute path", async () => {
    await setup();
    expect(invoke("sessions_delete", { path: "/etc/passwd" })).toEqual(refusal);
  });

  it("should refuse the sessions directory itself", async () => {
    await setup();
    expect(invoke("sessions_delete", { path: "/ws/sessions" })).toEqual(refusal);
  });
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
