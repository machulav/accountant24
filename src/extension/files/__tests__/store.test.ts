import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-file-store-"));

import { mock } from "bun:test";

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

const { copyFileToWorkspace } = await import("../store.js");

afterEach(() => {
  const filesDir = join(BASE, "files");
  if (existsSync(filesDir)) {
    rmSync(filesDir, { recursive: true, force: true });
  }
});

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

function createTestFile(name: string, content: Buffer): string {
  const dir = join(BASE, "input");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe("copyFileToWorkspace()", () => {
  test("should throw when file does not exist", () => {
    expect(() => copyFileToWorkspace("/nonexistent/file.png")).toThrow("File not found");
  });

  test("should return a string path", () => {
    const path = createTestFile("ret.png", MINIMAL_PNG);
    const storedPath = copyFileToWorkspace(path);

    expect(typeof storedPath).toBe("string");
  });

  test("should return a workspace-relative path, not absolute", () => {
    const path = createTestFile("rel.png", MINIMAL_PNG);
    const storedPath = copyFileToWorkspace(path);

    expect(storedPath.startsWith("/")).toBe(false);
    expect(storedPath.startsWith("files/")).toBe(true);
  });

  test("should return a path inside YYYY/MM directory", () => {
    const path = createTestFile("statement.png", MINIMAL_PNG);
    const storedPath = copyFileToWorkspace(path);

    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");

    expect(storedPath).toContain(join("files", year, month));
  });

  test("should name file with compact timestamp and extension only", () => {
    const path = createTestFile("statement.png", MINIMAL_PNG);
    const storedPath = copyFileToWorkspace(path);

    expect(basename(storedPath)).toMatch(/^\d{14}\.png$/);
  });

  test("should preserve original file content", () => {
    const path = createTestFile("original.png", MINIMAL_PNG);
    const storedPath = copyFileToWorkspace(path);

    expect(readFileSync(join(BASE, storedPath))).toEqual(MINIMAL_PNG);
  });

  test("should never overwrite previously stored files", () => {
    const path = createTestFile("dup.png", MINIMAL_PNG);

    const p1 = copyFileToWorkspace(path);
    const p2 = copyFileToWorkspace(path);
    const p3 = copyFileToWorkspace(path);

    expect(new Set([p1, p2, p3]).size).toBe(3);
    expect(existsSync(join(BASE, p1))).toBe(true);
    expect(existsSync(join(BASE, p2))).toBe(true);
    expect(existsSync(join(BASE, p3))).toBe(true);
  });

  test("should append -N suffix to deduplicated files", () => {
    const path = createTestFile("dup2.png", MINIMAL_PNG);

    copyFileToWorkspace(path);
    const p2 = copyFileToWorkspace(path);

    expect(basename(p2)).toMatch(/-2\.png$/);
  });

  test("should not include original filename in stored path", () => {
    const path = createTestFile("my-important-document.png", MINIMAL_PNG);
    const storedPath = copyFileToWorkspace(path);

    expect(storedPath).not.toContain("my-important-document");
  });

  test("should deduplicate different files with the same extension", () => {
    const path1 = createTestFile("alpha.png", MINIMAL_PNG);
    const path2 = createTestFile("bravo.png", MINIMAL_PNG);

    const p1 = copyFileToWorkspace(path1);
    const p2 = copyFileToWorkspace(path2);

    expect(p1).not.toBe(p2);
    expect(existsSync(join(BASE, p1))).toBe(true);
    expect(existsSync(join(BASE, p2))).toBe(true);
  });

  test("should handle files without extension", () => {
    const path = createTestFile("noext", MINIMAL_PNG);
    const storedPath = copyFileToWorkspace(path);

    expect(basename(storedPath)).toMatch(/^\d{14}$/);
    expect(readFileSync(join(BASE, storedPath))).toEqual(MINIMAL_PNG);
  });

  describe("copy_file_to_workspace tool", () => {
    test("should return stored path as content text", async () => {
      const { copyFileToWorkspaceTool } = await import("../../tools/copy-file-to-workspace.js");
      const path = createTestFile("tool-test.png", MINIMAL_PNG);

      const result = await copyFileToWorkspaceTool.execute("id", { file_path: path }, undefined, undefined, {} as any);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("files/");
      expect(text).toMatch(/\d{14}\.png/);
    });

    test("should return storedPath in details", async () => {
      const { copyFileToWorkspaceTool } = await import("../../tools/copy-file-to-workspace.js");
      const path = createTestFile("tool-details.png", MINIMAL_PNG);

      const result = await copyFileToWorkspaceTool.execute("id", { file_path: path }, undefined, undefined, {} as any);

      expect(result.details.storedPath).toBeTruthy();
      expect(existsSync(join(BASE, result.details.storedPath))).toBe(true);
    });

    test("should render Stored section when expanded", async () => {
      const { copyFileToWorkspaceTool } = await import("../../tools/copy-file-to-workspace.js");
      const path = createTestFile("render-test.png", MINIMAL_PNG);
      const execResult = await copyFileToWorkspaceTool.execute(
        "id",
        { file_path: path },
        undefined,
        undefined,
        {} as any,
      );

      const mockTheme = { fg: (_: string, s: string) => s, bg: (_: string, s: string) => s, bold: (s: string) => s };
      const rendered = copyFileToWorkspaceTool.renderResult?.(
        execResult,
        { expanded: true, isPartial: false },
        mockTheme as any,
        { isError: false } as any,
      );

      const lines = (rendered as any).render(200) as string[];
      const text = lines.join("\n");
      expect(text).toContain("Stored");
      expect(text).toMatch(/\d{14}/);
    });
  });
});
