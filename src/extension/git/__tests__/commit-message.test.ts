import { describe, expect, test } from "bun:test";
import { buildCommitMessage } from "../auto-commit";

describe("buildCommitMessage()", () => {
  test("should list a single file", () => {
    expect(buildCommitMessage(["ledger/2025/03.journal"])).toBe("Update 03.journal");
  });

  test("should list multiple files", () => {
    expect(buildCommitMessage(["ledger/2025/03.journal", "memory.md"])).toBe("Update 03.journal, memory.md");
  });

  test("should use basename only", () => {
    expect(buildCommitMessage(["deeply/nested/path/file.txt"])).toBe("Update file.txt");
  });

  test("should truncate with '+ N more' when too many files", () => {
    const files = Array.from({ length: 20 }, (_, i) => `ledger/file-${i}.journal`);
    const msg = buildCommitMessage(files);
    expect(msg.length).toBeLessThanOrEqual(72);
    expect(msg).toContain("+ ");
    expect(msg).toContain(" more");
  });

  test("should not truncate when all files fit in 72 chars", () => {
    const files = ["a.txt", "b.txt", "c.txt"];
    const msg = buildCommitMessage(files);
    expect(msg).toBe("Update a.txt, b.txt, c.txt");
    expect(msg).not.toContain("more");
  });

  test("should handle a single long filename", () => {
    const longName = `${"a".repeat(80)}.txt`;
    const msg = buildCommitMessage([longName]);
    // Single file always shown even if over 72 chars
    expect(msg).toBe(`Update ${longName}`);
  });

  test("should show '+ 1 more' for exactly one remaining file", () => {
    // Create files where the second one would push past 72 chars
    const files = [`${"a".repeat(50)}.txt`, `${"b".repeat(50)}.txt`];
    const msg = buildCommitMessage(files);
    expect(msg).toContain("+ 1 more");
  });

  test("should handle empty file list", () => {
    expect(buildCommitMessage([])).toBe("Update ");
  });
});
