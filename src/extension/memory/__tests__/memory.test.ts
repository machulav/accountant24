import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-memory-"));

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: join(BASE, "ledger"),
  MEMORY_PATH: join(BASE, "memory.md"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

const { getMemory, saveMemory } = await import("../memory.js");

beforeEach(() => {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
});

// ── getMemory() ─────────────────────────────────────────────────────

describe("getMemory()", () => {
  test("should return file contents trimmed", async () => {
    writeFileSync(join(BASE, "memory.md"), "  ## Personal\n- Name: Volo\n  ");
    const result = await getMemory();
    expect(result).toBe("## Personal\n- Name: Volo");
  });

  test("should return empty string when file does not exist", async () => {
    const result = await getMemory();
    expect(result).toBe("");
  });

  test("should return empty string when file is empty", async () => {
    writeFileSync(join(BASE, "memory.md"), "");
    const result = await getMemory();
    expect(result).toBe("");
  });

  test("should return empty string when file contains only whitespace", async () => {
    writeFileSync(join(BASE, "memory.md"), "   \n  \n  ");
    const result = await getMemory();
    expect(result).toBe("");
  });

  test("should preserve internal newlines", async () => {
    writeFileSync(join(BASE, "memory.md"), "## Section 1\n- item\n\n## Section 2\n- item\n");
    const result = await getMemory();
    expect(result).toBe("## Section 1\n- item\n\n## Section 2\n- item");
  });
});

// ── saveMemory() ────────────────────────────────────────────────────

describe("saveMemory()", () => {
  test("should write content to memory.md with trailing newline", () => {
    saveMemory("## Personal\n- Name: Volo");
    const content = readFileSync(join(BASE, "memory.md"), "utf-8");
    expect(content).toBe("## Personal\n- Name: Volo\n");
  });

  test("should trim content before writing", () => {
    saveMemory("  ## Personal  \n- Name: Volo  \n  ");
    const content = readFileSync(join(BASE, "memory.md"), "utf-8");
    expect(content).toBe("## Personal  \n- Name: Volo\n");
  });

  test("should create parent directories if missing", () => {
    rmSync(BASE, { recursive: true, force: true });
    saveMemory("new content");
    const content = readFileSync(join(BASE, "memory.md"), "utf-8");
    expect(content).toBe("new content\n");
  });

  test("should overwrite existing content", () => {
    writeFileSync(join(BASE, "memory.md"), "old content\n");
    saveMemory("new content");
    const content = readFileSync(join(BASE, "memory.md"), "utf-8");
    expect(content).toBe("new content\n");
  });

  test("should return diff showing changes", () => {
    writeFileSync(join(BASE, "memory.md"), "old line\n");
    const result = saveMemory("new line");
    expect(result.diff).toContain("-");
    expect(result.diff).toContain("old line");
    expect(result.diff).toContain("+");
    expect(result.diff).toContain("new line");
  });

  test("should return diff with additions when file is new", () => {
    const result = saveMemory("first content");
    expect(result.diff).toContain("+");
    expect(result.diff).toContain("first content");
  });

  test("should return empty diff when content is unchanged", () => {
    writeFileSync(join(BASE, "memory.md"), "same content\n");
    const result = saveMemory("same content");
    expect(result.diff).toBe("");
  });
});
