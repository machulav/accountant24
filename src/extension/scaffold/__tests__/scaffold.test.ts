import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import { ensureScaffolded } from "../scaffold.js";

const TEMPLATE_DIR = join(import.meta.dirname, "../template");

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

describe("ensureScaffolded()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "scaffold-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should create ledger directory", () => {
    ensureScaffolded(tmpDir);
    expect(existsSync(join(tmpDir, "ledger"))).toBe(true);
  });

  test("should create .sessions directory", () => {
    ensureScaffolded(tmpDir);
    expect(existsSync(join(tmpDir, ".sessions"))).toBe(true);
  });

  test("should write main.journal with header and include directive", () => {
    ensureScaffolded(tmpDir);
    const content = readFileSync(join(tmpDir, "ledger", "main.journal"), "utf-8");
    expect(content).toContain("; Accountant24");
    expect(content).toContain("include accounts.journal");
  });

  test("should write accounts.journal with all five account types", () => {
    ensureScaffolded(tmpDir);
    const content = readFileSync(join(tmpDir, "ledger", "accounts.journal"), "utf-8");
    expect(content).toContain("account assets:");
    expect(content).toContain("account liabilities:");
    expect(content).toContain("account equity:");
    expect(content).toContain("account income:");
    expect(content).toContain("account expenses:");
  });

  test("should write .gitignore with auth exclusion", () => {
    ensureScaffolded(tmpDir);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(content).toContain("auth.json");
  });

  test("should produce an output file for every template file", () => {
    ensureScaffolded(tmpDir);
    const templateFiles = collectFiles(TEMPLATE_DIR).map((f) => relative(TEMPLATE_DIR, f));
    for (const relPath of templateFiles) {
      expect(existsSync(join(tmpDir, relPath))).toBe(true);
    }
  });

  test("should have at least one template file", () => {
    const templateFiles = collectFiles(TEMPLATE_DIR);
    expect(templateFiles.length).toBeGreaterThan(0);
  });

  test("should not overwrite existing main.journal", () => {
    mkdirSync(join(tmpDir, "ledger"), { recursive: true });
    writeFileSync(join(tmpDir, "ledger", "main.journal"), "existing content");

    ensureScaffolded(tmpDir);

    expect(readFileSync(join(tmpDir, "ledger", "main.journal"), "utf-8")).toBe("existing content");
  });

  test("should not overwrite existing accounts.journal", () => {
    mkdirSync(join(tmpDir, "ledger"), { recursive: true });
    writeFileSync(join(tmpDir, "ledger", "accounts.journal"), "user modified accounts");

    ensureScaffolded(tmpDir);

    expect(readFileSync(join(tmpDir, "ledger", "accounts.journal"), "utf-8")).toBe("user modified accounts");
  });

  test("should not overwrite existing .gitignore", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "custom gitignore");

    ensureScaffolded(tmpDir);

    expect(readFileSync(join(tmpDir, ".gitignore"), "utf-8")).toBe("custom gitignore");
  });

  test("should create empty memory.md", () => {
    ensureScaffolded(tmpDir);
    expect(existsSync(join(tmpDir, "memory.md"))).toBe(true);
    expect(readFileSync(join(tmpDir, "memory.md"), "utf-8")).toBe("");
  });

  test("should not overwrite existing memory.md", () => {
    writeFileSync(join(tmpDir, "memory.md"), "user memories");

    ensureScaffolded(tmpDir);

    expect(readFileSync(join(tmpDir, "memory.md"), "utf-8")).toBe("user memories");
  });

  test("should still create missing files when some already exist", () => {
    mkdirSync(join(tmpDir, "ledger"), { recursive: true });
    writeFileSync(join(tmpDir, "ledger", "main.journal"), "custom main");

    ensureScaffolded(tmpDir);

    // main.journal preserved
    expect(readFileSync(join(tmpDir, "ledger", "main.journal"), "utf-8")).toBe("custom main");
    // accounts.journal created because it was missing
    expect(existsSync(join(tmpDir, "ledger", "accounts.journal"))).toBe(true);
    // .gitignore created because it was missing
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
  });
});
