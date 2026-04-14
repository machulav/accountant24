import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-validate-"));
const LEDGER = join(BASE, "ledger");

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: LEDGER,
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

// Mock at Bun.spawn level — the only spawn call is hledger check.
const origSpawn = Bun.spawn;

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return {
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
  };
}

let mockExitCode: number;
let mockStdout: string;
let mockStderr: string;

const setMock = (exit: number, stdout = "", stderr = "") => {
  mockExitCode = exit;
  mockStdout = stdout;
  mockStderr = stderr;
};

const { validateTool } = await import("../validate.js");

afterAll(() => {
  Bun.spawn = origSpawn;
  rmSync(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  setMock(0);
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = mock(() => makeMockProc(mockExitCode, mockStdout, mockStderr));
  // Clean and recreate ledger dir per test
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
});

afterEach(() => {
  Bun.spawn = origSpawn;
});

const run = (params: any) =>
  validateTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

test("throws when hledger not found", async () => {
  setMock(127);
  await expect(run({})).rejects.toThrow("hledger not found");
});

test("returns valid result on success", async () => {
  setMock(0);
  const result = await run({});
  expect(result.details.ledgerIsValid).toBe(true);
});

test("throws on validation failure", async () => {
  setMock(1, "", "hledger: Error: account not declared");
  await expect(run({})).rejects.toThrow("account not declared");
});

test("re-throws unexpected errors", async () => {
  Bun.spawn = mock(() => {
    throw new TypeError("unexpected");
  });
  await expect(run({})).rejects.toThrow("unexpected");
});

// ── rendering wiring ──────────────────────────────────────────────

const mockTheme = { fg: (_c: string, t: string) => t, bold: (t: string) => t } as any;

test("renderCall should show label", () => {
  // biome-ignore lint/style/noNonNullAssertion: renderCall is defined on this tool
  const component = validateTool.renderCall!({}, mockTheme, {
    lastComponent: undefined,
    executionStarted: true,
    isPartial: false,
    isError: false,
  } as any);
  const output = component.render(120).join("\n");
  expect(output).toContain("Validate Ledger");
});

test("renderResult should show valid message when expanded", () => {
  const result = {
    content: [{ type: "text" as const, text: "The ledger is valid." }],
    details: { ledgerIsValid: true },
  };
  // biome-ignore lint/style/noNonNullAssertion: renderResult is defined
  const component = validateTool.renderResult!(result, { expanded: true, isPartial: false }, mockTheme, {} as any);
  const output = component.render(120).join("\n");
  expect(output).toContain("The ledger is valid.");
});
