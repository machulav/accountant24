import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-scaffold-"));

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  setBaseDir: () => {},
}));

const { ensureScaffolded } = await import("../scaffold/scaffold.js");

const TEMPLATE_DIR = join(import.meta.dirname, "../scaffold/template");

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

describe("ensureScaffolded()", () => {
  beforeEach(() => {
    // Clean BASE for each test
    rmSync(BASE, { recursive: true, force: true });
    mkdirSync(BASE, { recursive: true });
  });

  test("should create ledger directory", () => {
    ensureScaffolded();
    expect(existsSync(join(BASE, "ledger"))).toBe(true);
  });

  test("should create sessions directory", () => {
    ensureScaffolded();
    expect(existsSync(join(BASE, "sessions"))).toBe(true);
  });

  test("should write main.journal with header and include directive", () => {
    ensureScaffolded();
    const content = readFileSync(join(BASE, "ledger", "main.journal"), "utf-8");
    expect(content).toContain("; Accountant24");
    expect(content).toContain("include accounts.journal");
  });

  test("should write accounts.journal with all five account types", () => {
    ensureScaffolded();
    const content = readFileSync(join(BASE, "ledger", "accounts.journal"), "utf-8");
    expect(content).toContain("account assets:");
    expect(content).toContain("account liabilities:");
    expect(content).toContain("account equity:");
    expect(content).toContain("account income:");
    expect(content).toContain("account expenses:");
  });

  test("should write .gitignore with auth exclusion", () => {
    ensureScaffolded();
    const content = readFileSync(join(BASE, ".gitignore"), "utf-8");
    expect(content).toContain("auth.json");
  });

  test("should produce an output file for every template file", () => {
    ensureScaffolded();
    const templateFiles = collectFiles(TEMPLATE_DIR).map((f) => relative(TEMPLATE_DIR, f));
    for (const relPath of templateFiles) {
      expect(existsSync(join(BASE, relPath))).toBe(true);
    }
  });

  test("should have at least one template file", () => {
    const templateFiles = collectFiles(TEMPLATE_DIR);
    expect(templateFiles.length).toBeGreaterThan(0);
  });

  test("should not overwrite existing main.journal", () => {
    mkdirSync(join(BASE, "ledger"), { recursive: true });
    writeFileSync(join(BASE, "ledger", "main.journal"), "existing content");

    ensureScaffolded();

    expect(readFileSync(join(BASE, "ledger", "main.journal"), "utf-8")).toBe("existing content");
  });

  test("should not overwrite existing accounts.journal", () => {
    mkdirSync(join(BASE, "ledger"), { recursive: true });
    writeFileSync(join(BASE, "ledger", "accounts.journal"), "user modified accounts");

    ensureScaffolded();

    expect(readFileSync(join(BASE, "ledger", "accounts.journal"), "utf-8")).toBe("user modified accounts");
  });

  test("should not overwrite existing .gitignore", () => {
    writeFileSync(join(BASE, ".gitignore"), "custom gitignore");

    ensureScaffolded();

    expect(readFileSync(join(BASE, ".gitignore"), "utf-8")).toBe("custom gitignore");
  });

  test("should create empty memory.md", () => {
    ensureScaffolded();
    expect(existsSync(join(BASE, "memory.md"))).toBe(true);
    expect(readFileSync(join(BASE, "memory.md"), "utf-8")).toBe("");
  });

  test("should not overwrite existing memory.md", () => {
    writeFileSync(join(BASE, "memory.md"), "user memories");

    ensureScaffolded();

    expect(readFileSync(join(BASE, "memory.md"), "utf-8")).toBe("user memories");
  });

  test("should still create missing files when some already exist", () => {
    mkdirSync(join(BASE, "ledger"), { recursive: true });
    writeFileSync(join(BASE, "ledger", "main.journal"), "custom main");

    ensureScaffolded();

    // main.journal preserved
    expect(readFileSync(join(BASE, "ledger", "main.journal"), "utf-8")).toBe("custom main");
    // accounts.journal created because it was missing
    expect(existsSync(join(BASE, "ledger", "accounts.journal"))).toBe(true);
    // .gitignore created because it was missing
    expect(existsSync(join(BASE, ".gitignore"))).toBe(true);
  });
});
