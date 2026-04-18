import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-scaffold-"));

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  setBaseDir: () => {},
}));

const { ensureScaffolded } = await import("../scaffold.js");

/** Expected template files — mirrors the manifest in scaffold.ts. */
const EXPECTED_TEMPLATE_FILES = [
  "memory.md",
  ".gitignore",
  "models.json",
  "settings.json",
  "ledger/accounts.txt",
  "ledger/main.txt",
];

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

describe("ensureScaffolded()", () => {
  beforeEach(() => {
    // Clean BASE for each test
    rmSync(BASE, { recursive: true, force: true });
    mkdirSync(BASE, { recursive: true });
  });

  test("should create ledger directory", async () => {
    await ensureScaffolded();
    expect(existsSync(join(BASE, "ledger"))).toBe(true);
  });

  test("should create sessions directory", async () => {
    await ensureScaffolded();
    expect(existsSync(join(BASE, "sessions"))).toBe(true);
  });

  test("should create files directory", async () => {
    await ensureScaffolded();
    expect(existsSync(join(BASE, "files"))).toBe(true);
  });

  test("should write main.txt with header and include directive", async () => {
    await ensureScaffolded();
    const content = readFileSync(join(BASE, "ledger", "main.txt"), "utf-8");
    expect(content).toContain("# Accountant24");
    expect(content).toContain("include accounts.txt");
  });

  test("should write accounts.txt with all five account types", async () => {
    await ensureScaffolded();
    const content = readFileSync(join(BASE, "ledger", "accounts.txt"), "utf-8");
    expect(content).toContain("account assets:");
    expect(content).toContain("account liabilities:");
    expect(content).toContain("account equity:");
    expect(content).toContain("account income:");
    expect(content).toContain("account expenses:");
  });

  test("should write .gitignore with auth exclusion", async () => {
    await ensureScaffolded();
    const content = readFileSync(join(BASE, ".gitignore"), "utf-8");
    expect(content).toContain("auth.json");
  });

  test("should produce an output file for every template file", async () => {
    await ensureScaffolded();
    for (const relPath of EXPECTED_TEMPLATE_FILES) {
      expect(existsSync(join(BASE, relPath))).toBe(true);
    }
  });

  test("should not overwrite existing main.txt", async () => {
    mkdirSync(join(BASE, "ledger"), { recursive: true });
    writeFileSync(join(BASE, "ledger", "main.txt"), "existing content");

    await ensureScaffolded();

    expect(readFileSync(join(BASE, "ledger", "main.txt"), "utf-8")).toBe("existing content");
  });

  test("should not overwrite existing accounts.txt", async () => {
    mkdirSync(join(BASE, "ledger"), { recursive: true });
    writeFileSync(join(BASE, "ledger", "accounts.txt"), "user modified accounts");

    await ensureScaffolded();

    expect(readFileSync(join(BASE, "ledger", "accounts.txt"), "utf-8")).toBe("user modified accounts");
  });

  test("should not overwrite existing .gitignore", async () => {
    writeFileSync(join(BASE, ".gitignore"), "custom gitignore");

    await ensureScaffolded();

    expect(readFileSync(join(BASE, ".gitignore"), "utf-8")).toBe("custom gitignore");
  });

  test("should create empty memory.md", async () => {
    await ensureScaffolded();
    expect(existsSync(join(BASE, "memory.md"))).toBe(true);
    expect(readFileSync(join(BASE, "memory.md"), "utf-8")).toBe("");
  });

  test("should not overwrite existing memory.md", async () => {
    writeFileSync(join(BASE, "memory.md"), "user memories");

    await ensureScaffolded();

    expect(readFileSync(join(BASE, "memory.md"), "utf-8")).toBe("user memories");
  });

  test("should still create missing files when some already exist", async () => {
    mkdirSync(join(BASE, "ledger"), { recursive: true });
    writeFileSync(join(BASE, "ledger", "main.txt"), "custom main");

    await ensureScaffolded();

    // main.txt preserved
    expect(readFileSync(join(BASE, "ledger", "main.txt"), "utf-8")).toBe("custom main");
    // accounts.txt created because it was missing
    expect(existsSync(join(BASE, "ledger", "accounts.txt"))).toBe(true);
    // .gitignore created because it was missing
    expect(existsSync(join(BASE, ".gitignore"))).toBe(true);
  });

  test("should initialize a git repo", async () => {
    await ensureScaffolded();
    expect(existsSync(join(BASE, ".git"))).toBe(true);
  });

  test("should not reinitialize git repo on second run", async () => {
    await ensureScaffolded();
    const { statSync } = await import("node:fs");
    const firstGitTime = statSync(join(BASE, ".git")).birthtimeMs;

    await ensureScaffolded();
    const secondGitTime = statSync(join(BASE, ".git")).birthtimeMs;

    expect(secondGitTime).toBe(firstGitTime);
  });

  test("should create initial commit with scaffolded files", async () => {
    await ensureScaffolded();
    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: BASE, stdout: "pipe", stderr: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("Initial Accountant24 setup");
  });

  test("should not create another commit on second run", async () => {
    await ensureScaffolded();
    await ensureScaffolded();
    const proc = Bun.spawn(["git", "log", "--oneline"], { cwd: BASE, stdout: "pipe", stderr: "pipe" });
    const log = await new Response(proc.stdout).text();
    const lines = log
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
  });
});
