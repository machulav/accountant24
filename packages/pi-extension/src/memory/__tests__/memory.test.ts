import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-memory-"));

vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: join(BASE, "ledger"),
  MEMORY_PATH: join(BASE, "memory.md"),
  setBaseDir: () => {},
}));

const { getMemory } = await import("../memory.js");

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
