import { test, expect, afterAll, mock } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = mkdtempSync(join(tmpdir(), "beanclaw-write-file-"));
mock.module("../../config.js", () => ({ BEANCLAW_HOME: BASE }));

const { resolveSafePath, runCommand } = await import("../utils.js");
mock.module("../utils.js", () => ({ resolveSafePath, runCommand }));

const { writeFileTool } = await import("../write-file.js");

afterAll(() => rmSync(BASE, { recursive: true, force: true }));

const run = (params: any) => writeFileTool.execute("test", params) as Promise<any>;

test("writes file and reports bytes", async () => {
  const result = await run({ path: "out.txt", content: "data" });
  expect(result.content[0].text).toContain("4 bytes");
  expect(readFileSync(join(BASE, "out.txt"), "utf-8")).toBe("data");
});

test("creates parent directories", async () => {
  await run({ path: "a/b/c.txt", content: "nested" });
  expect(readFileSync(join(BASE, "a/b/c.txt"), "utf-8")).toBe("nested");
});

test("throws on path escape", async () => {
  await expect(run({ path: "../escape.txt", content: "bad" })).rejects.toThrow(
    "Path escapes base directory",
  );
});
