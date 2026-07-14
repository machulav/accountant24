import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { setBaseDir } from "../config";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-ext-"));

// No mock.module calls — use real modules to avoid mock leaks.
// Extension tests work with real modules + temp filesystem via setBaseDir.
const { createAccountantExtension } = await import("../extension.js");

const accountant24Extension = createAccountantExtension;

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
    registerTool: vi.fn(() => {}),
    registerCommand: vi.fn(() => {}),
    on: vi.fn((event: string, handler: AnyFn) => {
      handlers[event] = handler;
    }),
    sendMessage: vi.fn(() => {}),
    handlers,
  };
}

describe("accountant24Extension()", () => {
  test("should register 6 custom tools (built-ins are pi's own)", () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    expect(pi.registerTool).toHaveBeenCalledTimes(6);
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
    await pi.handlers.session_start();

    expect(existsSync(join(BASE, "ledger"))).toBe(true);
  });
});

describe("before_agent_start handler", () => {
  // pi hands the hook its fully assembled base prompt (our system.md via
  // --system-prompt + the <available_skills> block + date/cwd lines); the
  // extension extends that base. Tool snippets + guidelines come from pi's
  // systemPromptOptions (computed from the enabled tools).
  const basePrompt =
    "<soul>\nAccountant24 base from system.md\n</soul>\n" +
    "<available_skills>\n<skill>\n<name>pdf</name>\n</skill>\n</available_skills>\n" +
    "Current date: 2020-01-01\n" +
    "Current working directory: /workspace";

  const beforeEvent = {
    systemPrompt: basePrompt,
    systemPromptOptions: {
      selectedTools: ["read", "bash", "edit", "query", "commit_and_push"],
      toolSnippets: {
        read: "Read file contents",
        bash: "Execute bash commands",
        edit: "Make precise file edits",
        query: "Run hledger reports",
        commit_and_push: "Commit all changes and push to remote",
      },
      promptGuidelines: ["Call commit_and_push after completing a batch of related changes."],
    },
  };

  test("should return object with systemPrompt key", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start();

    const result = await pi.handlers.before_agent_start(beforeEvent);
    expect(result).toHaveProperty("systemPrompt");
    expect(typeof result.systemPrompt).toBe("string");
    expect(result.systemPrompt.length).toBeGreaterThan(0);
  });

  test("should forward pi's enabled-tool snippets into the tools section", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start();

    const result = await pi.handlers.before_agent_start(beforeEvent);
    const prompt = result.systemPrompt as string;
    expect(prompt).toContain("<tools>");
    expect(prompt).toContain("</tools>");
    expect(prompt).toContain("- read: Read file contents");
    expect(prompt).toContain("- query: Run hledger reports");
    expect(prompt).toContain("- commit_and_push: Commit all changes and push to remote");
  });

  test("should omit tools without a snippet", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start();

    const event = {
      systemPrompt: basePrompt,
      systemPromptOptions: {
        selectedTools: ["read", "secret"],
        toolSnippets: { read: "Read file contents" },
        promptGuidelines: [],
      },
    };
    const result = await pi.handlers.before_agent_start(event);
    const prompt = result.systemPrompt as string;
    expect(prompt).toContain("- read:");
    expect(prompt).not.toContain("- secret");
  });

  test("should include context wrapper around dynamic sections", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start();

    const result = await pi.handlers.before_agent_start(beforeEvent);
    const prompt = result.systemPrompt as string;
    expect(prompt).toContain("<context>");
    expect(prompt).toContain("</context>");

    const contextStart = prompt.indexOf("<context>");
    const datePos = prompt.indexOf("Today's date:");
    expect(datePos).toBeGreaterThan(contextStart);
  });

  test("should include pi's tool guidelines", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start();

    const result = await pi.handlers.before_agent_start(beforeEvent);
    const prompt = result.systemPrompt as string;
    expect(prompt).toContain("Guidelines:");
    expect(prompt).toContain("commit_and_push after completing a batch");
  });

  test("should preserve pi's assembled base prompt (system.md + skills block) at the start", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start();

    const result = await pi.handlers.before_agent_start(beforeEvent);
    const prompt = result.systemPrompt as string;
    expect(prompt.startsWith("<soul>\nAccountant24 base from system.md\n</soul>")).toBe(true);
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("Current working directory: /workspace");
  });

  test("should re-stamp pi's baked date line with today's date", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start();

    const result = await pi.handlers.before_agent_start(beforeEvent);
    const prompt = result.systemPrompt as string;
    const today = new Date().toISOString().split("T")[0];
    expect(prompt).toContain(`Current date: ${today}`);
    expect(prompt).not.toContain("Current date: 2020-01-01");
  });

  test("should append tools and context after the base prompt", async () => {
    const pi = createMockPi();
    accountant24Extension(pi as any);
    await pi.handlers.session_start();

    const result = await pi.handlers.before_agent_start(beforeEvent);
    const prompt = result.systemPrompt as string;
    const cwdPos = prompt.indexOf("Current working directory:");
    const toolsPos = prompt.indexOf("<tools>");
    const contextPos = prompt.indexOf("<context>");
    expect(cwdPos).toBeLessThan(toolsPos);
    expect(toolsPos).toBeLessThan(contextPos);
  });
});
