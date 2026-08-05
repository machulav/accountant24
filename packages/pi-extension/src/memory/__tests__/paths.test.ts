import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test, vi } from "vitest";

// A workspace dir with a space in it makes the unicode-space normalization
// observable. isMemoryFilePath is pure string work, so no filesystem is touched.
const WORKSPACE = join(homedir(), "Accountant 24");

vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: WORKSPACE,
  LEDGER_DIR: join(WORKSPACE, "ledger"),
  MEMORY_PATH: join(WORKSPACE, "memory.md"),
  setBaseDir: () => {},
}));

const { isMemoryFilePath } = await import("../paths.js");

describe("isMemoryFilePath()", () => {
  test("should return true for a relative memory.md against the workspace cwd", () => {
    expect(isMemoryFilePath("memory.md", WORKSPACE)).toBe(true);
  });

  test("should return true for ./memory.md", () => {
    expect(isMemoryFilePath("./memory.md", WORKSPACE)).toBe(true);
  });

  test("should return true for the absolute memory path", () => {
    expect(isMemoryFilePath(join(WORKSPACE, "memory.md"), WORKSPACE)).toBe(true);
  });

  test("should strip a leading @ like pi's file tools", () => {
    expect(isMemoryFilePath("@memory.md", WORKSPACE)).toBe(true);
  });

  test("should expand a leading tilde", () => {
    expect(isMemoryFilePath("~/Accountant 24/memory.md", "/somewhere/else")).toBe(true);
  });

  test("should normalize unicode spaces like pi's file tools", () => {
    expect(isMemoryFilePath("~/Accountant\u00A024/memory.md", "/somewhere/else")).toBe(true);
  });

  test("should resolve file:// URLs", () => {
    expect(isMemoryFilePath(pathToFileURL(join(WORKSPACE, "memory.md")).href, WORKSPACE)).toBe(true);
  });

  test("should return false for memory.md in a subdirectory", () => {
    expect(isMemoryFilePath("ledger/memory.md", WORKSPACE)).toBe(false);
  });

  test("should return false for a relative memory.md when cwd is a subdirectory", () => {
    expect(isMemoryFilePath("memory.md", join(WORKSPACE, "ledger"))).toBe(false);
  });

  test("should return false for other files in the workspace", () => {
    expect(isMemoryFilePath("memory.md.bak", WORKSPACE)).toBe(false);
    expect(isMemoryFilePath("ledger/main.journal", WORKSPACE)).toBe(false);
  });

  test("should return false for non-string input", () => {
    expect(isMemoryFilePath(undefined, WORKSPACE)).toBe(false);
    expect(isMemoryFilePath(null, WORKSPACE)).toBe(false);
    expect(isMemoryFilePath(123, WORKSPACE)).toBe(false);
    expect(isMemoryFilePath({ path: "memory.md" }, WORKSPACE)).toBe(false);
  });

  test("should return false for an empty string", () => {
    expect(isMemoryFilePath("", WORKSPACE)).toBe(false);
  });

  test("should return false instead of throwing on a malformed file URL", () => {
    expect(isMemoryFilePath("file://%", WORKSPACE)).toBe(false);
  });
});
