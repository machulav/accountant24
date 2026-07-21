import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ollama.ts wraps three I/O boundaries — Electron IPC, node:fs (models.json),
// and fetch (the local Ollama server). All are faked; the merge/validation/
// baking logic runs for real, driven through the registered IPC handlers.
type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  authStorage: {
    logout: vi.fn(),
  },
  trackProviderConnected: vi.fn(),
  fs: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
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
  ModelRegistry: { create: () => ({}) },
}));
vi.mock("node:fs", () => ({
  existsSync: h.fs.existsSync,
  readFileSync: h.fs.readFileSync,
  writeFileSync: h.fs.writeFileSync,
}));

/** Import ollama.ts fresh and register its handlers. */
async function setup() {
  const { registerOllamaIpc } = await import("../ollama");
  registerOllamaIpc();
}

const invoke = (channel: string, payload?: unknown) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, payload);
};

/** Minimal fetch Response stub. */
const jsonResponse = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

/** The JSON object written by the nth writeFileSync call. */
const writtenJson = (n = 0): Record<string, unknown> => JSON.parse(h.fs.writeFileSync.mock.calls[n][1] as string);

beforeEach(() => {
  h.handlers.clear();
  // clearMocks only clears call history — restore the default implementations
  // so per-test mockReturnValue overrides can't leak into the next test.
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
