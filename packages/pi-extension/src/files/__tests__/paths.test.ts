import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-file-paths-"));

import { mock } from "bun:test";

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

const { resolveWorkspacePath } = await import("../paths.js");

describe("resolveWorkspacePath()", () => {
  describe("valid relative paths", () => {
    test("should resolve a simple relative path", () => {
      const result = resolveWorkspacePath("files/2026/04/file.pdf");
      expect(result).toBe(join(BASE, "files/2026/04/file.pdf"));
    });

    test("should resolve a path with ./ prefix", () => {
      const result = resolveWorkspacePath("./files/2026/04/file.pdf");
      expect(result).toBe(join(BASE, "files/2026/04/file.pdf"));
    });

    test("should resolve a bare filename", () => {
      const result = resolveWorkspacePath("file.pdf");
      expect(result).toBe(join(BASE, "file.pdf"));
    });
  });

  describe("absolute paths", () => {
    test("should reject absolute paths", () => {
      expect(() => resolveWorkspacePath("/Users/volodymyr/Accountant24/files/file.pdf")).toThrow(
        "Absolute paths are not accepted",
      );
    });

    test("should include the rejected path in error message", () => {
      expect(() => resolveWorkspacePath("/tmp/file.pdf")).toThrow("/tmp/file.pdf");
    });
  });

  describe("tilde paths", () => {
    test("should reject tilde-prefixed paths", () => {
      expect(() => resolveWorkspacePath("~/Accountant24/files/file.pdf")).toThrow("Tilde paths are not accepted");
    });

    test("should include the rejected path in error message", () => {
      expect(() => resolveWorkspacePath("~/file.pdf")).toThrow("~/file.pdf");
    });
  });

  describe("path traversal", () => {
    test("should reject paths that escape the workspace", () => {
      expect(() => resolveWorkspacePath("../etc/passwd")).toThrow("Path escapes base directory");
    });

    test("should reject deeply nested traversal", () => {
      expect(() => resolveWorkspacePath("files/../../etc/passwd")).toThrow("Path escapes base directory");
    });
  });
});
