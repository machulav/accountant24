import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  today,
  PROVIDER_MODELS,
  DEFAULT_ACCOUNTS,
  verifyApiKey,
  scaffoldProject,
} from "./wizard.utils.js";

describe("today", () => {
  test("returns YYYY-MM-DD format", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("matches current date", () => {
    const expected = new Date().toISOString().slice(0, 10);
    expect(today()).toBe(expected);
  });
});

describe("PROVIDER_MODELS", () => {
  test("has entries for anthropic and openai", () => {
    expect(PROVIDER_MODELS.anthropic).toBeDefined();
    expect(PROVIDER_MODELS.openai).toBeDefined();
  });

  test("each option has value and label", () => {
    for (const [, options] of Object.entries(PROVIDER_MODELS)) {
      for (const opt of options) {
        expect(opt.value).toBeString();
        expect(opt.label).toBeString();
      }
    }
  });
});

describe("DEFAULT_ACCOUNTS", () => {
  test("is a non-empty array", () => {
    expect(DEFAULT_ACCOUNTS.length).toBeGreaterThan(0);
  });

  test("every account is a colon-separated path", () => {
    for (const account of DEFAULT_ACCOUNTS) {
      expect(account).toMatch(/^\w+:\w/);
    }
  });

  test("includes Equity:Opening-Balances", () => {
    expect(DEFAULT_ACCOUNTS).toContain("Equity:Opening-Balances");
  });
});

describe("verifyApiKey", () => {
  const mockGetModel = (_p: string, _m: string) => ({ id: "test" }) as any;

  test("returns ok:true when completeSimple succeeds", async () => {
    const result = await verifyApiKey("anthropic", "claude-sonnet-4-6", "sk-test", {
      getModel: mockGetModel,
      completeSimple: async () => ({ stopReason: "stop" }) as any,
    });
    expect(result).toEqual({ ok: true });
  });

  test("returns ok:false when stopReason is error", async () => {
    const result = await verifyApiKey("anthropic", "claude-sonnet-4-6", "sk-bad", {
      getModel: mockGetModel,
      completeSimple: async () =>
        ({ stopReason: "error", errorMessage: "Invalid key" }) as any,
    });
    expect(result).toEqual({ ok: false, error: "Invalid key" });
  });

  test("returns fallback message when errorMessage is undefined", async () => {
    const result = await verifyApiKey("anthropic", "claude-sonnet-4-6", "sk-bad", {
      getModel: mockGetModel,
      completeSimple: async () => ({ stopReason: "error" }) as any,
    });
    expect(result).toEqual({
      ok: false,
      error: "Invalid API key or could not connect to the LLM provider.",
    });
  });

  test("returns ok:false when completeSimple throws", async () => {
    const result = await verifyApiKey("anthropic", "claude-sonnet-4-6", "sk-bad", {
      getModel: mockGetModel,
      completeSimple: async () => {
        throw new Error("Network error");
      },
    });
    expect(result).toEqual({ ok: false, error: "Network error" });
  });

  test("passes correct systemPrompt and maxTokens", async () => {
    let capturedContext: any;
    let capturedOptions: any;
    await verifyApiKey("anthropic", "claude-sonnet-4-6", "sk-test", {
      getModel: mockGetModel,
      completeSimple: async (_m, ctx, opts) => {
        capturedContext = ctx;
        capturedOptions = opts;
        return { stopReason: "stop" } as any;
      },
    });
    expect(capturedContext.systemPrompt).toBe("Respond with exactly: OK");
    expect(capturedOptions.maxTokens).toBe(16);
  });
});

describe("scaffoldProject", () => {
  let tmpDir: string;
  const testConfig = {
    llm_provider: "anthropic",
    llm_model: "claude-sonnet-4-6",
    api_key: "sk-test-key",
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "beanclaw-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates ledger directory", () => {
    scaffoldProject({ config: testConfig, baseDir: tmpDir, date: "2025-01-15" });
    expect(existsSync(join(tmpDir, "ledger"))).toBe(true);
  });

  test("creates documents directory", () => {
    scaffoldProject({ config: testConfig, baseDir: tmpDir, date: "2025-01-15" });
    expect(existsSync(join(tmpDir, "documents"))).toBe(true);
  });

  test("creates .sessions directory", () => {
    scaffoldProject({ config: testConfig, baseDir: tmpDir, date: "2025-01-15" });
    expect(existsSync(join(tmpDir, ".sessions"))).toBe(true);
  });

  test("writes config.json with correct content", () => {
    scaffoldProject({ config: testConfig, baseDir: tmpDir, date: "2025-01-15" });
    const content = JSON.parse(
      readFileSync(join(tmpDir, "config.json"), "utf-8"),
    );
    expect(content).toEqual(testConfig);
  });

  test("writes memory.json with empty initial structure", () => {
    scaffoldProject({ config: testConfig, baseDir: tmpDir, date: "2025-01-15" });
    const content = JSON.parse(
      readFileSync(join(tmpDir, "memory.json"), "utf-8"),
    );
    expect(content).toEqual({ facts: [] });
  });

  test("writes main.journal with comment header and include", () => {
    scaffoldProject({ config: testConfig, baseDir: tmpDir, date: "2025-01-15" });
    const content = readFileSync(
      join(tmpDir, "ledger", "main.journal"),
      "utf-8",
    );
    expect(content).toContain("; BeanClaw Personal Finances");
    expect(content).toContain("include accounts.journal");
  });

  test("writes accounts.journal with account declarations", () => {
    scaffoldProject({ config: testConfig, baseDir: tmpDir, date: "2025-01-15" });
    const content = readFileSync(
      join(tmpDir, "ledger", "accounts.journal"),
      "utf-8",
    );
    for (const account of DEFAULT_ACCOUNTS) {
      expect(content).toContain(`account ${account}`);
    }
    expect(content.endsWith("\n")).toBe(true);
  });

  test("writes .gitignore", () => {
    scaffoldProject({ config: testConfig, baseDir: tmpDir, date: "2025-01-15" });
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(content).toContain(".sessions/");
    expect(content).toContain("config.json");
  });

  test("is idempotent", () => {
    scaffoldProject({ config: testConfig, baseDir: tmpDir, date: "2025-01-15" });
    expect(() => {
      scaffoldProject({ config: testConfig, baseDir: tmpDir, date: "2025-01-15" });
    }).not.toThrow();
  });
});
