import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setBaseDir } from "../config";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-ext-"));

// No mock.module calls — use real modules to avoid mock leaks.
// Extension tests work with real modules + temp filesystem via setBaseDir.
const { accountant24Extension } = await import("../extension.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));

beforeEach(() => {
  rmSync(BASE, { recursive: true, force: true });
  setBaseDir(BASE);
});

// biome-ignore lint/complexity/noBannedTypes: test helper needs generic callable
type AnyFn = Function;

function createMockPi() {
  const handlers: Record<string, AnyFn> = {};
  return {
    registerTool: mock(() => {}),
    registerCommand: mock(() => {}),
    registerMessageRenderer: mock(() => {}),
    on: mock((event: string, handler: AnyFn) => {
      handlers[event] = handler;
    }),
    getCommands: mock(() => [{ name: "accounts", description: "List accounts" }]),
    sendMessage: mock(() => {}),
    handlers,
  };
}

describe("Loader currency animation", () => {
  test("should patch Loader.prototype.updateDisplay with currency frames", async () => {
    const { Loader } = await import("@mariozechner/pi-tui");
    const proto = Loader.prototype as any;
    const obj = {
      currentFrame: 0,
      message: "Loading",
      messageColorFn: (t: string) => t,
      setText: mock(() => {}),
      ui: { requestRender: mock(() => {}) },
    };
    proto.updateDisplay.call(obj);
    expect(obj.setText).toHaveBeenCalledTimes(1);
    const text = (obj.setText.mock.calls[0] as any)[0] as string;
    // Should contain a green-colored currency symbol
    expect(text).toContain("\x1b[32m");
    expect(text).toContain("Loading");
    expect(obj.ui.requestRender).toHaveBeenCalled();
  });
});

describe("accountant24Extension()", () => {
  test("should register 4 tools", () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    expect(pi.registerTool).toHaveBeenCalledTimes(4);
  });

  test("should register session_start and before_agent_start handlers", () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    expect(pi.on).toHaveBeenCalledTimes(2);
    expect(pi.handlers.session_start).toBeDefined();
    expect(pi.handlers.before_agent_start).toBeDefined();
  });
});

describe("ensureScaffolded (via session_start)", () => {
  test("should scaffold workspace on session_start", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start({}, { hasUI: false });

    expect(existsSync(join(BASE, "ledger"))).toBe(true);
  });
});

describe("session_start UI setup", () => {
  test("should set title and header when hasUI", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    let editorFactory: AnyFn | null = null;
    let footerFactory: AnyFn | null = null;
    const ctx = {
      hasUI: true,
      ui: {
        setTitle: mock(() => {}),
        setHeader: mock(() => {}),
        setFooter: mock((factory: AnyFn) => {
          footerFactory = factory;
        }),
        setEditorComponent: mock((factory: AnyFn) => {
          editorFactory = factory;
        }),
      },
    };
    await pi.handlers.session_start({}, ctx);
    expect(ctx.ui.setTitle).toHaveBeenCalledWith("Accountant24");
    expect(ctx.ui.setHeader).toHaveBeenCalledTimes(1);
    expect(ctx.ui.setFooter).toHaveBeenCalledTimes(1);
    expect(ctx.ui.setEditorComponent).toHaveBeenCalledTimes(1);

    // Invoke the editor factory to cover editor setup (lines 101-106)
    expect(editorFactory).not.toBeNull();
    const editor = (editorFactory as any)({}, {}, {});
    expect(editor).toBeDefined();
    // Call the no-op setAutocompleteProvider guard (line 104)
    editor.setAutocompleteProvider("should be ignored");

    // Invoke the footer factory and its returned render/invalidate
    expect(footerFactory).not.toBeNull();
    const footer = (footerFactory as any)();
    expect(footer.render()).toEqual([]);
    footer.invalidate();
  });

  test("should not set UI when hasUI is false", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start({}, { hasUI: false });
  });
});

describe("before_agent_start handler", () => {
  test("should return object with systemPrompt key", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start({}, { hasUI: false });

    const result = await pi.handlers.before_agent_start({}, { hasUI: false });
    expect(result).toHaveProperty("systemPrompt");
    expect(typeof result.systemPrompt).toBe("string");
    expect(result.systemPrompt.length).toBeGreaterThan(0);
  });

  test("should set working message when hasUI", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start({}, { hasUI: false });

    const ctx = { hasUI: true, ui: { setWorkingMessage: mock(() => {}) } };
    await pi.handlers.before_agent_start({}, ctx);
    expect(ctx.ui.setWorkingMessage).toHaveBeenCalledWith("Crunching the numbers...");
  });
});
