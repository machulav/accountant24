import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHostConfig } from "../../../shared/agentHost";
import type { UiBridge } from "../host/host";

// runtime.ts builds the real pi runtime per session. The pi SDK is the faked
// boundary; the specs pin the exact configuration contract: the old spawn
// flags (--no-* / --system-prompt / --skill / -e / --session) expressed as SDK
// options, one shared auth/models runtime per host, and NO model passed (it
// must restore from the session file — CLI-style resolution can process.exit).

const h = vi.hoisted(() => ({
  modelRuntime: { id: "model-runtime" },
  sessionManager: { id: "session-manager" },
  services: { id: "services", diagnostics: [{ note: "diag" }] },
  session: {
    bindExtensions: vi.fn(async (_bindings: unknown) => {}),
    agent: { waitForIdle: vi.fn(async () => {}) },
    reload: vi.fn(async () => {}),
    navigateTree: vi.fn(async (_id: unknown, _opts: unknown) => ({ cancelled: false })),
  },
  runtimeCreate: vi.fn(async (_opts: unknown) => h.modelRuntime),
  sessionOpen: vi.fn((_path: unknown, _dir: unknown) => h.sessionManager),
  createServices: vi.fn(async (_opts: unknown) => h.services),
  createFromServices: vi.fn(async (_opts: unknown) => ({ session: h.session, extensionsResult: {} })),
  createRuntime: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: h.runtimeCreate },
  SessionManager: { open: h.sessionOpen },
  createAgentSessionServices: h.createServices,
  createAgentSessionFromServices: h.createFromServices,
  createAgentSessionRuntime: h.createRuntime,
}));

const cfg: AgentHostConfig = {
  workspaceDir: "/ws",
  sessionsDir: "/ws/sessions",
  skills: [
    { path: "/res/plugins/accountant24/skills/recurring-spending", name: "accountant24:recurring-spending" },
    { path: "/ws/plugins/budget/skills/monthly-review", name: "budget:monthly-review" },
  ],
  extensionPath: "/res/accountant24-extension.js",
  systemPromptPath: "/res/system.md",
};

const A = "/ws/sessions/a.jsonl";

function makeUi(): UiBridge {
  return { emit: vi.fn(), pending: new Map() };
}

/** The runtime object the mocked createAgentSessionRuntime returns. */
const fakeRuntime = { session: h.session, dispose: vi.fn(async () => {}) };

beforeEach(() => {
  vi.resetModules();
  // The mocked createAgentSessionRuntime behaves like the real one: it invokes
  // the given factory with the resolved options, then returns the runtime.
  h.createRuntime.mockImplementation(
    async (factory: (opts: unknown) => Promise<unknown>, opts: Record<string, unknown>) => {
      await factory({
        cwd: opts.cwd,
        agentDir: opts.agentDir,
        sessionManager: opts.sessionManager,
        sessionStartEvent: { type: "session_start" },
      });
      return fakeRuntime;
    },
  );
});

async function createRuntimeForSession(ui: UiBridge = makeUi()) {
  const { createRuntimeFactory } = await import("../host/runtime");
  const factory = createRuntimeFactory(cfg);
  return { runtime: await factory(A, ui), factory };
}

describe("createRuntimeFactory()", () => {
  it("should create one shared model runtime per host, from the workspace files", async () => {
    const { factory } = await createRuntimeForSession();
    await factory("/ws/sessions/b.jsonl", makeUi());

    expect(h.runtimeCreate).toHaveBeenCalledTimes(1);
    expect(h.runtimeCreate).toHaveBeenCalledWith({
      authPath: "/ws/auth.json",
      modelsPath: "/ws/models.json",
      modelsStore: expect.anything(),
    });
  });

  it("should keep pi's catalog cache in memory, out of the user's ledger directory", async () => {
    await createRuntimeForSession();

    // A file-backed store would drop an empty models-store.json beside the
    // ledger; we never refresh catalogs over the network, so there is nothing
    // to persist.
    const options = h.runtimeCreate.mock.calls[0][0] as { modelsStore?: { write?: unknown } };
    expect(options.modelsStore).toBeInstanceOf(InMemoryModelsStore);
    expect("modelsStorePath" in options).toBe(false);
  });

  it("should open the session at its minted path with the sessions dir (fresh AND reopen contract)", async () => {
    await createRuntimeForSession();
    expect(h.sessionOpen).toHaveBeenCalledWith(A, "/ws/sessions");
    expect(h.createRuntime).toHaveBeenCalledWith(expect.any(Function), {
      cwd: "/ws",
      agentDir: "/ws",
      sessionManager: h.sessionManager,
    });
  });

  it("should mirror the old spawn flags in the services resource-loader options", async () => {
    await createRuntimeForSession();

    expect(h.createServices).toHaveBeenCalledWith({
      cwd: "/ws",
      agentDir: "/ws",
      modelRuntime: h.modelRuntime,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        systemPrompt: "/res/system.md",
        additionalSkillPaths: [
          "/res/plugins/accountant24/skills/recurring-spending",
          "/ws/plugins/budget/skills/monthly-review",
        ],
        skillsOverride: expect.any(Function),
        additionalExtensionPaths: ["/res/accountant24-extension.js"],
      },
    });
  });

  describe("skillsOverride", () => {
    /** The hook pi applies to the loaded skill set, pulled off the recorded
     *  createAgentSessionServices call. */
    async function loadOverride() {
      await createRuntimeForSession();
      const opts = h.createServices.mock.calls[0][0] as {
        resourceLoaderOptions: {
          skillsOverride: (base: { skills: unknown[]; diagnostics: unknown[] }) => {
            skills: { name: string }[];
            diagnostics: unknown[];
          };
        };
      };
      return opts.resourceLoaderOptions.skillsOverride;
    }

    it("should rename a loaded skill to its <plugin>:<skill> name", async () => {
      const override = await loadOverride();
      const result = override({
        skills: [{ name: "monthly-review", baseDir: "/ws/plugins/budget/skills/monthly-review", description: "d" }],
        diagnostics: [],
      });
      expect(result.skills).toEqual([
        { name: "budget:monthly-review", baseDir: "/ws/plugins/budget/skills/monthly-review", description: "d" },
      ]);
    });

    it("should leave a skill loaded from an unknown folder untouched", async () => {
      const override = await loadOverride();
      const result = override({
        skills: [{ name: "stray", baseDir: "/somewhere/else", description: "d" }],
        diagnostics: [],
      });
      expect(result.skills).toEqual([{ name: "stray", baseDir: "/somewhere/else", description: "d" }]);
    });

    it("should pass diagnostics through untouched", async () => {
      const override = await loadOverride();
      const diagnostics = [{ type: "warning", message: "w" }];
      expect(override({ skills: [], diagnostics }).diagnostics).toBe(diagnostics);
    });
  });

  it("should create the session from services WITHOUT a model or thinking level", async () => {
    await createRuntimeForSession();

    expect(h.createFromServices).toHaveBeenCalledWith({
      services: h.services,
      sessionManager: h.sessionManager,
      sessionStartEvent: { type: "session_start" },
    });
    const options = h.createFromServices.mock.calls[0][0] as Record<string, unknown>;
    expect("model" in options).toBe(false);
    expect("thinkingLevel" in options).toBe(false);
  });

  it("should bind extensions in rpc mode with cancelled session-replacement actions", async () => {
    await createRuntimeForSession();

    expect(h.session.bindExtensions).toHaveBeenCalledTimes(1);
    const bindings = h.session.bindExtensions.mock.calls[0][0] as {
      mode: string;
      uiContext: unknown;
      commandContextActions: Record<string, (...args: never[]) => Promise<unknown>>;
      onError: (err: { extensionPath: string; event: string; error: string }) => void;
    };
    expect(bindings.mode).toBe("rpc");
    expect(bindings.uiContext).toBeDefined();
    // One runtime per chat: extensions can never replace the session.
    await expect(bindings.commandContextActions.newSession()).resolves.toEqual({ cancelled: true });
    await expect(bindings.commandContextActions.fork()).resolves.toEqual({ cancelled: true });
    await expect(bindings.commandContextActions.switchSession()).resolves.toEqual({ cancelled: true });
  });

  it("should delegate waitForIdle/reload/navigateTree to the live session", async () => {
    await createRuntimeForSession();
    const bindings = h.session.bindExtensions.mock.calls[0][0] as {
      commandContextActions: {
        waitForIdle: () => Promise<void>;
        reload: () => Promise<void>;
        navigateTree: (id: string, opts?: Record<string, unknown>) => Promise<{ cancelled: boolean }>;
      };
    };

    await bindings.commandContextActions.waitForIdle();
    expect(h.session.agent.waitForIdle).toHaveBeenCalled();
    await bindings.commandContextActions.reload();
    expect(h.session.reload).toHaveBeenCalled();
    await expect(bindings.commandContextActions.navigateTree("e1", { summarize: true })).resolves.toEqual({
      cancelled: false,
    });
  });

  it("should emit extension errors through the ui bridge", async () => {
    const ui = makeUi();
    await createRuntimeForSession(ui);
    const bindings = h.session.bindExtensions.mock.calls[0][0] as {
      onError: (err: { extensionPath: string; event: string; error: string }) => void;
    };

    bindings.onError({ extensionPath: "/res/ext.js", event: "tool_call", error: "boom" });
    expect(ui.emit).toHaveBeenCalledWith({
      type: "extension_error",
      extensionPath: "/res/ext.js",
      event: "tool_call",
      error: "boom",
    });
  });
});

describe("extension UI context", () => {
  async function getUiContext(ui: UiBridge) {
    await createRuntimeForSession(ui);
    const bindings = h.session.bindExtensions.mock.calls[0][0] as {
      uiContext: {
        select(
          title: string,
          options: string[],
          opts?: { signal?: AbortSignal; timeout?: number },
        ): Promise<string | undefined>;
        confirm(title: string, message: string, opts?: { timeout?: number }): Promise<boolean>;
        input(title: string, placeholder?: string): Promise<string | undefined>;
        editor(title: string, prefill?: string): Promise<string | undefined>;
        notify(message: string, type?: string): void;
        setStatus(key: string, text?: string): void;
        setWidget(key: string, content?: string[] | (() => void)): void;
        setTitle(title: string): void;
        setEditorText(text: string): void;
        pasteToEditor(text: string): void;
        getEditorText(): string;
      };
    };
    return bindings.uiContext;
  }

  /** The last extension_ui_request the context emitted. */
  const lastRequest = (ui: UiBridge): Record<string, unknown> =>
    (ui.emit as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as Record<string, unknown>;

  it("should emit a select request and resolve with the responded value", async () => {
    const ui = makeUi();
    const ctx = await getUiContext(ui);
    const choice = ctx.select("Pick", ["a", "b"]);

    const request = lastRequest(ui);
    expect(request).toMatchObject({
      type: "extension_ui_request",
      method: "select",
      title: "Pick",
      options: ["a", "b"],
    });
    ui.pending.get(String(request.id))?.resolve({ value: "b" });
    await expect(choice).resolves.toBe("b");
    expect(ui.pending.size).toBe(0);
  });

  it("should resolve a cancelled confirm as false", async () => {
    const ui = makeUi();
    const ctx = await getUiContext(ui);
    const answer = ctx.confirm("Sure?", "really");
    ui.pending.get(String(lastRequest(ui).id))?.resolve({ cancelled: true });
    await expect(answer).resolves.toBe(false);
  });

  it("should resolve a confirmed confirm as true", async () => {
    const ui = makeUi();
    const ctx = await getUiContext(ui);
    const answer = ctx.confirm("Sure?", "really");
    ui.pending.get(String(lastRequest(ui).id))?.resolve({ confirmed: true });
    await expect(answer).resolves.toBe(true);
  });

  it("should resolve input and editor with the responded value", async () => {
    const ui = makeUi();
    const ctx = await getUiContext(ui);

    const input = ctx.input("Name?", "placeholder");
    ui.pending.get(String(lastRequest(ui).id))?.resolve({ value: "Alice" });
    await expect(input).resolves.toBe("Alice");

    const edited = ctx.editor("Edit", "draft");
    ui.pending.get(String(lastRequest(ui).id))?.resolve({ value: "final" });
    await expect(edited).resolves.toBe("final");
  });

  it("should resolve the default immediately when the signal is already aborted", async () => {
    const ui = makeUi();
    const ctx = await getUiContext(ui);
    const controller = new AbortController();
    controller.abort();

    await expect(ctx.select("Pick", ["a"], { signal: controller.signal })).resolves.toBeUndefined();
    expect(ui.emit).not.toHaveBeenCalledWith(expect.objectContaining({ method: "select" }));
  });

  it("should resolve the default when the dialog times out", async () => {
    vi.useFakeTimers();
    try {
      const ui = makeUi();
      const ctx = await getUiContext(ui);
      const answer = ctx.confirm("Sure?", "really", { timeout: 500 });
      await vi.advanceTimersByTimeAsync(500);
      await expect(answer).resolves.toBe(false);
      expect(ui.pending.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should emit fire-and-forget requests for notify/setStatus/setTitle/setEditorText", async () => {
    const ui = makeUi();
    const ctx = await getUiContext(ui);

    ctx.notify("saved", "info");
    expect(lastRequest(ui)).toMatchObject({ method: "notify", message: "saved", notifyType: "info" });
    ctx.setStatus("git", "clean");
    expect(lastRequest(ui)).toMatchObject({ method: "setStatus", statusKey: "git", statusText: "clean" });
    ctx.setTitle("Accountant");
    expect(lastRequest(ui)).toMatchObject({ method: "setTitle", title: "Accountant" });
    ctx.setEditorText("hello");
    expect(lastRequest(ui)).toMatchObject({ method: "set_editor_text", text: "hello" });
    ctx.pasteToEditor("pasted");
    expect(lastRequest(ui)).toMatchObject({ method: "set_editor_text", text: "pasted" });
    expect(ui.pending.size).toBe(0);
  });

  it("should emit widget lines but drop component factories", async () => {
    const ui = makeUi();
    const ctx = await getUiContext(ui);

    ctx.setWidget("stats", ["line 1"]);
    expect(lastRequest(ui)).toMatchObject({ method: "setWidget", widgetKey: "stats", widgetLines: ["line 1"] });

    const before = (ui.emit as ReturnType<typeof vi.fn>).mock.calls.length;
    ctx.setWidget("stats", () => {});
    expect((ui.emit as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(before);
  });

  it("should return an empty editor text synchronously", async () => {
    const ctx = await getUiContext(makeUi());
    expect(ctx.getEditorText()).toBe("");
  });

  it("should resolve the default when the signal aborts while the dialog is open", async () => {
    const ui = makeUi();
    const ctx = await getUiContext(ui);
    const controller = new AbortController();

    const choice = ctx.select("Pick", ["a"], { signal: controller.signal });
    expect(ui.pending.size).toBe(1);
    controller.abort();
    await expect(choice).resolves.toBeUndefined();
    expect(ui.pending.size).toBe(0);
  });

  it("should keep every TUI-only method an inert no-op", async () => {
    const ui = makeUi();
    await createRuntimeForSession(ui);
    const bindings = h.session.bindExtensions.mock.calls[0][0] as {
      uiContext: Record<string, (...args: never[]) => unknown>;
    };
    const ctx = bindings.uiContext;

    // Interactive-mode-only surface: callable, emits nothing, returns the
    // documented defaults (mirrors rpc-mode's stubs).
    expect(ctx.onTerminalInput()).toBeTypeOf("function");
    (ctx.onTerminalInput() as () => void)();
    ctx.setWorkingMessage();
    ctx.setWorkingVisible(true as never);
    ctx.setWorkingIndicator();
    ctx.setHiddenThinkingLabel();
    ctx.setFooter();
    ctx.setHeader();
    ctx.addAutocompleteProvider();
    ctx.setEditorComponent();
    expect(ctx.getEditorComponent()).toBeUndefined();
    expect(ctx.getAllThemes()).toEqual([]);
    expect(ctx.getTheme("dark" as never)).toBeUndefined();
    expect(ctx.setTheme("dark" as never)).toEqual({
      success: false,
      error: "Theme switching is not supported in the agent host",
    });
    expect(ctx.getToolsExpanded()).toBe(false);
    ctx.setToolsExpanded(true as never);
    await expect(ctx.custom()).resolves.toBeUndefined();
    expect(ui.emit).not.toHaveBeenCalled();
  });
});
