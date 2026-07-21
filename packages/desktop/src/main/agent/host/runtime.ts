// The real pi SDK runtime factory — one AgentSessionRuntime per chat session,
// configured exactly like the old `pi --mode rpc` spawn args:
//
//   --no-extensions --no-skills --no-prompt-templates  → resourceLoaderOptions no*
//   --system-prompt <system.md>                        → resourceLoaderOptions.systemPrompt
//   --skill <native> --skill <enabled…>                → additionalSkillPaths
//   -e <accountant24-extension.js>                     → additionalExtensionPaths
//   --session <path> --session-dir <sessions>          → SessionManager.open(path, dir)
//   cwd / PI_CODING_AGENT_DIR                          → cwd / agentDir options
//
// No model/thinkingLevel is passed: pi restores both from the session file (or
// falls back to settings/first-available). Never resolve models CLI-style here
// — that path can process.exit(1) on an unresolvable model.

import { join } from "node:path";
import {
  AuthStorage,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type ExtensionUIContext,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentHostConfig } from "../../../shared/agentHost";
import { enabledSkillPaths } from "../skills-store";
import type { RuntimeFactory, UiBridge } from "./host";

export function createRuntimeFactory(cfg: AgentHostConfig): RuntimeFactory {
  // One auth/models registry shared by every session in this host — reading
  // the workspace files the llm-providers/ modules write. Killing the host (the
  // agent_restart flow) is what picks up credential changes.
  const authStorage = AuthStorage.create(join(cfg.workspaceDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, join(cfg.workspaceDir, "models.json"));

  return async (sessionPath, ui) => {
    const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        authStorage,
        modelRegistry,
        resourceLoaderOptions: {
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          systemPrompt: cfg.systemPromptPath,
          additionalSkillPaths: [cfg.nativeSkillsDir, ...enabledSkillPaths(cfg.skillsDir)],
          additionalExtensionPaths: [cfg.extensionPath],
        },
      });
      const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent });
      return { ...created, services, diagnostics: services.diagnostics };
    };

    const runtime = await createAgentSessionRuntime(factory, {
      cwd: cfg.workspaceDir,
      agentDir: cfg.workspaceDir,
      // open() starts a fresh session at a not-yet-existing path and reopens an
      // existing file (restoring history/model/thinking) — the same contract the
      // old `--session <path>` spawn relied on.
      sessionManager: SessionManager.open(sessionPath, cfg.sessionsDir),
    });

    await runtime.session.bindExtensions({
      uiContext: createUiContext(ui),
      mode: "rpc",
      commandContextActions: {
        waitForIdle: () => runtime.session.agent.waitForIdle(),
        reload: async () => {
          await runtime.session.reload();
        },
        navigateTree: async (targetId, options) => {
          const result = await runtime.session.navigateTree(targetId, {
            summarize: options?.summarize,
            customInstructions: options?.customInstructions,
            replaceInstructions: options?.replaceInstructions,
            label: options?.label,
          });
          return { cancelled: result.cancelled };
        },
        // One runtime per chat — session replacement is the app's job (the
        // renderer creates threads), never an extension command's.
        newSession: async () => ({ cancelled: true }),
        fork: async () => ({ cancelled: true }),
        switchSession: async () => ({ cancelled: true }),
      },
      onError: (err) => {
        ui.emit({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
      },
    });

    return runtime;
  };
}

/** Port of RPC mode's extension UI context: blocking dialogs become
 *  extension_ui_request events answered via extension_ui_response (the
 *  renderer auto-confirms them, unchanged); display-only methods emit
 *  fire-and-forget; TUI-only methods are no-ops. The accountant24 extension
 *  uses none of this — it exists so a skill or future extension that does
 *  can't hang the session. */
function createUiContext(ui: UiBridge): ExtensionUIContext {
  let requestCounter = 0;
  const nextId = () => `ui${++requestCounter}`;

  function dialog<T>(
    request: Record<string, unknown>,
    defaultValue: T,
    parse: (response: Record<string, unknown>) => T,
    opts?: { signal?: AbortSignal; timeout?: number },
  ): Promise<T> {
    if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
    const id = nextId();
    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        opts?.signal?.removeEventListener("abort", onAbort);
        ui.pending.delete(id);
      };
      const onAbort = () => {
        cleanup();
        resolve(defaultValue);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts?.timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          resolve(defaultValue);
        }, opts.timeout);
      }
      ui.pending.set(id, {
        resolve: (response) => {
          cleanup();
          resolve(parse(response));
        },
        reject,
      });
      ui.emit({ type: "extension_ui_request", id, ...request });
    });
  }

  const context: Omit<ExtensionUIContext, "theme"> = {
    select: (title, options, opts) =>
      dialog(
        { method: "select", title, options, timeout: opts?.timeout },
        undefined,
        (r) => (r.cancelled ? undefined : typeof r.value === "string" ? r.value : undefined),
        opts,
      ),
    confirm: (title, message, opts) =>
      dialog(
        { method: "confirm", title, message, timeout: opts?.timeout },
        false,
        (r) => (r.cancelled ? false : r.confirmed === true),
        opts,
      ),
    input: (title, placeholder, opts) =>
      dialog(
        { method: "input", title, placeholder, timeout: opts?.timeout },
        undefined,
        (r) => (r.cancelled ? undefined : typeof r.value === "string" ? r.value : undefined),
        opts,
      ),
    editor: (title, prefill) =>
      dialog<string | undefined>({ method: "editor", title, prefill }, undefined, (r) =>
        r.cancelled ? undefined : typeof r.value === "string" ? r.value : undefined,
      ),
    notify(message, type) {
      ui.emit({ type: "extension_ui_request", id: nextId(), method: "notify", message, notifyType: type });
    },
    setStatus(key, text) {
      ui.emit({ type: "extension_ui_request", id: nextId(), method: "setStatus", statusKey: key, statusText: text });
    },
    setWidget(key, content, options) {
      // Only string arrays travel over the wire — component factories need a TUI.
      if (content === undefined || Array.isArray(content)) {
        ui.emit({
          type: "extension_ui_request",
          id: nextId(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        });
      }
    },
    setTitle(title) {
      ui.emit({ type: "extension_ui_request", id: nextId(), method: "setTitle", title });
    },
    setEditorText(text) {
      ui.emit({ type: "extension_ui_request", id: nextId(), method: "set_editor_text", text });
    },
    pasteToEditor(text) {
      this.setEditorText(text);
    },
    getEditorText: () => "",
    onTerminalInput: () => () => {},
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setFooter() {},
    setHeader() {},
    // Same behavior as RPC mode's stub: custom UI resolves to nothing.
    custom: async <T>(): Promise<T> => undefined as T,
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent: () => undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Theme switching is not supported in the agent host" }),
    getToolsExpanded: () => false,
    setToolsExpanded() {},
  };
  // `theme` is a TUI concern with no headless equivalent; nothing in the
  // accountant24 extension (or pi core outside interactive mode) reads it.
  return context as ExtensionUIContext;
}
