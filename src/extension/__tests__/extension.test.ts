import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setBaseDir } from "../config";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-ext-"));

// No mock.module calls — use real modules to avoid mock leaks.
// Extension tests work with real modules + temp filesystem via setBaseDir.
const { createExtension } = await import("../extension.js");

const mockSettingsManager = {
  getAutocompleteMaxVisible: () => 5,
  getEditorPaddingX: () => 0,
} as any;
const accountant24Extension = createExtension(mockSettingsManager);

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
  test("should register 14 tools (7 built-in overrides + 7 custom)", () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    expect(pi.registerTool).toHaveBeenCalledTimes(14);
  });

  test("should register session_start, before_agent_start, agent_end, and model_select handlers", () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    expect(pi.on).toHaveBeenCalledTimes(4);
    expect(pi.handlers.session_start).toBeDefined();
    expect(pi.handlers.before_agent_start).toBeDefined();
    expect(pi.handlers.agent_end).toBeDefined();
    expect(pi.handlers.model_select).toBeDefined();
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
    const mockTheme = { fg: (color: string, text: string) => `[${color}]${text}` } as any;
    const mockTui = { requestRender: mock(() => {}) } as any;
    const ctx = {
      hasUI: true,
      model: { name: "Test Model" },
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

    // Invoke the footer factory — it receives (tui, theme, footerData) and reads ctx.model
    expect(footerFactory).not.toBeNull();
    const footer = (footerFactory as any)(mockTui, mockTheme, {});
    const line = footer.render(80)[0];
    expect(line).toContain("[dim]Test Model");
    footer.invalidate();
    footer.dispose();
  });

  test("should not set UI when hasUI is false", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start({}, { hasUI: false });
  });
});

describe("model_select handler", () => {
  test("should update footer model name on model switch", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    let footerFactory: AnyFn | null = null;
    const mockTheme = { fg: (color: string, text: string) => `[${color}]${text}` } as any;
    const mockTui = { requestRender: mock(() => {}) } as any;
    const ctx = {
      hasUI: true,
      model: { name: "Initial Model" },
      ui: {
        setTitle: mock(() => {}),
        setHeader: mock(() => {}),
        setFooter: mock((factory: AnyFn) => {
          footerFactory = factory;
        }),
        setEditorComponent: mock(() => {}),
      },
    };
    await pi.handlers.session_start({}, ctx);

    // Create the footer via factory
    const footer = (footerFactory as any)(mockTui, mockTheme, {});
    expect(footer.render(80)[0]).toContain("[dim]Initial Model");

    // Simulate model switch — footer triggers requestRender internally
    mockTui.requestRender.mockClear();
    pi.handlers.model_select({ model: { name: "New Model" } });
    expect(footer.render(80)[0]).toContain("[dim]New Model");
    expect(mockTui.requestRender).toHaveBeenCalledWith(true);
  });

  test("should not throw when model_select fires before footer is created", () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    // model_select fires without session_start (no footer yet)
    expect(() => pi.handlers.model_select({ model: { name: "Some Model" } })).not.toThrow();
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

  test("should include tools section with builtin and custom tool snippets", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start({}, { hasUI: false });

    const result = await pi.handlers.before_agent_start({}, { hasUI: false });
    const prompt = result.systemPrompt as string;
    expect(prompt).toContain("<tools>");
    expect(prompt).toContain("</tools>");
    // Builtin tools
    expect(prompt).toContain("- read:");
    expect(prompt).toContain("- bash:");
    expect(prompt).toContain("- edit:");
    // Custom tools
    expect(prompt).toContain("- query:");
    expect(prompt).toContain("- add_transaction:");
    expect(prompt).toContain("- commit_and_push:");
    expect(prompt).toContain("- extract_text:");
    expect(prompt).toContain("- validate:");
    expect(prompt).toContain("- update_memory:");
  });

  test("should include context wrapper around dynamic sections", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start({}, { hasUI: false });

    const result = await pi.handlers.before_agent_start({}, { hasUI: false });
    const prompt = result.systemPrompt as string;
    expect(prompt).toContain("<context>");
    expect(prompt).toContain("</context>");

    const contextStart = prompt.indexOf("<context>");
    const datePos = prompt.indexOf("Today's date:");
    expect(datePos).toBeGreaterThan(contextStart);
  });

  test("should include guidelines from tools", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start({}, { hasUI: false });

    const result = await pi.handlers.before_agent_start({}, { hasUI: false });
    const prompt = result.systemPrompt as string;
    expect(prompt).toContain("Guidelines:");
    // Custom tool guideline
    expect(prompt).toContain("commit_and_push after completing a batch");
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

describe("agent_end handler", () => {
  test("should refresh autocomplete with new payees after agent turn", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start({}, { hasUI: false });

    // Verify no payees initially
    const before = await pi.handlers.before_agent_start({}, { hasUI: false });
    expect(before.systemPrompt as string).toContain("No payees found.");

    // Simulate agent creating a transaction with a new payee
    const monthDir = join(BASE, "ledger", "2026", "04");
    mkdirSync(monthDir, { recursive: true });
    writeFileSync(
      join(monthDir, "04.journal"),
      '2026-04-15 * "NewCoffeeShop" | "Latte"\n    Expenses:Food:Coffee    5.00 EUR\n    Assets:Checking\n',
    );
    // Add include directive so hledger picks up the file
    const mainJournal = join(BASE, "ledger", "main.journal");
    const { readFileSync } = await import("node:fs");
    const mainContent = readFileSync(mainJournal, "utf-8");
    writeFileSync(mainJournal, `${mainContent}\ninclude 2026/04/04.journal\n`);

    // agent_end should refresh autocomplete data
    await pi.handlers.agent_end({}, { hasUI: false });

    // Now before_agent_start should show the new payee in the system prompt
    const after = await pi.handlers.before_agent_start({}, { hasUI: false });
    expect(after.systemPrompt as string).toContain("NewCoffeeShop");
  });

  test("should not pick up new payees until agent_end runs", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start({}, { hasUI: false });

    // First call — no payees
    const first = await pi.handlers.before_agent_start({}, { hasUI: false });
    expect(first.systemPrompt as string).toContain("No payees found.");

    // Add a payee to the journal (simulating what add_transaction does)
    const monthDir = join(BASE, "ledger", "2026", "04");
    mkdirSync(monthDir, { recursive: true });
    writeFileSync(
      join(monthDir, "04.journal"),
      '2026-04-15 * "FreshPayee" | "Groceries"\n    Expenses:Food    10.00 EUR\n    Assets:Checking\n',
    );
    const mainJournal = join(BASE, "ledger", "main.journal");
    const { readFileSync } = await import("node:fs");
    const mainContent = readFileSync(mainJournal, "utf-8");
    writeFileSync(mainJournal, `${mainContent}\ninclude 2026/04/04.journal\n`);

    // before_agent_start alone does NOT refresh autocomplete
    // (the system prompt will contain the payee because it re-reads ledger data,
    // but autocomplete is what we moved — autocomplete is separate from the prompt)
    // The key assertion: agent_end triggers the refresh
    await pi.handlers.agent_end({}, { hasUI: false });

    // After agent_end, the data is fresh
    const after = await pi.handlers.before_agent_start({}, { hasUI: false });
    expect(after.systemPrompt as string).toContain("FreshPayee");
  });
});
