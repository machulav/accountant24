import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveSafePath } from "../paths";

describe("resolveSafePath()", () => {
  const baseDir = "/home/user/workspace";

  describe("valid paths", () => {
    test("should resolve a simple filename within base directory", () => {
      const result = resolveSafePath("main.journal", baseDir);
      expect(result).toBe(join(baseDir, "main.journal"));
    });

    test("should resolve a nested path within base directory", () => {
      const result = resolveSafePath("2026/03.journal", baseDir);
      expect(result).toBe(join(baseDir, "2026/03.journal"));
    });

    test("should resolve a deeply nested path", () => {
      const result = resolveSafePath("a/b/c/d.txt", baseDir);
      expect(result).toBe(join(baseDir, "a/b/c/d.txt"));
    });

    test("should normalize redundant separators", () => {
      const result = resolveSafePath("ledger//main.journal", baseDir);
      expect(result).toBe(join(baseDir, "ledger/main.journal"));
    });

    test("should resolve path with . segments", () => {
      const result = resolveSafePath("./main.journal", baseDir);
      expect(result).toBe(join(baseDir, "main.journal"));
    });

    test("should resolve path that navigates up but stays within base", () => {
      const result = resolveSafePath("sub/../main.journal", baseDir);
      expect(result).toBe(join(baseDir, "main.journal"));
    });
  });

  describe("path traversal rejection", () => {
    test("should throw when path escapes with ../", () => {
      expect(() => resolveSafePath("../etc/passwd", baseDir)).toThrow("Path escapes base directory");
    });

    test("should throw when path escapes with ../../", () => {
      expect(() => resolveSafePath("../../etc/passwd", baseDir)).toThrow("Path escapes base directory");
    });

    test("should throw when nested path escapes base", () => {
      expect(() => resolveSafePath("sub/../../etc/passwd", baseDir)).toThrow("Path escapes base directory");
    });

    test("should include the offending path in error message", () => {
      expect(() => resolveSafePath("../../secret", baseDir)).toThrow("../../secret");
    });

    test("should throw when an absolute path points outside the base", () => {
      expect(() => resolveSafePath("/etc/passwd", baseDir)).toThrow("Path escapes base directory");
    });

    test("should throw for a sibling dir that shares the base name as a prefix", () => {
      // "/home/user/workspace-evil" starts with "/home/user/workspace" as a
      // string but is NOT inside it — the separator check must reject it.
      expect(() => resolveSafePath("../workspace-evil/x", baseDir)).toThrow("Path escapes base directory");
    });
  });

  describe("boundary", () => {
    test("should allow a path that resolves to exactly the base directory", () => {
      expect(resolveSafePath("", baseDir)).toBe(baseDir);
      expect(resolveSafePath(".", baseDir)).toBe(baseDir);
    });
  });
});
