import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveSafePath } from "../paths";

describe("resolveSafePath()", () => {
  const baseDir = "/home/user/workspace";

  describe("valid paths", () => {
    test("should resolve a simple filename within base directory", () => {
      const result = resolveSafePath("main.txt", baseDir);
      expect(result).toBe(join(baseDir, "main.txt"));
    });

    test("should resolve a nested path within base directory", () => {
      const result = resolveSafePath("2026/03.txt", baseDir);
      expect(result).toBe(join(baseDir, "2026/03.txt"));
    });

    test("should resolve a deeply nested path", () => {
      const result = resolveSafePath("a/b/c/d.txt", baseDir);
      expect(result).toBe(join(baseDir, "a/b/c/d.txt"));
    });

    test("should normalize redundant separators", () => {
      const result = resolveSafePath("ledger//main.txt", baseDir);
      expect(result).toBe(join(baseDir, "ledger/main.txt"));
    });

    test("should resolve path with . segments", () => {
      const result = resolveSafePath("./main.txt", baseDir);
      expect(result).toBe(join(baseDir, "main.txt"));
    });

    test("should resolve path that navigates up but stays within base", () => {
      const result = resolveSafePath("sub/../main.txt", baseDir);
      expect(result).toBe(join(baseDir, "main.txt"));
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
  });
});
