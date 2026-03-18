import { expect, mock, test } from "bun:test";

mock.module("../../config.js", () => ({
  BEANCLAW_HOME: "/tmp",
}));

let mockResult = { exitCode: 0, stdout: "", stderr: "" };
mock.module("../utils.js", () => ({
  resolveSafePath: (p: string, base: string) => `${base}/${p}`,
  runCommand: async () => mockResult,
}));

const { bashTool } = await import("../bash.js");

const run = (params: any) => bashTool.execute("test", params) as Promise<any>;

test("returns output on success", async () => {
  mockResult = { exitCode: 0, stdout: "hello\n", stderr: "" };
  const result = await run({ command: "echo hello" });
  expect(result.content[0].text).toContain("Exit code: 0");
  expect(result.content[0].text).toContain("hello");
});

test("returns output with non-zero exit code", async () => {
  mockResult = { exitCode: 1, stdout: "", stderr: "" };
  const result = await run({ command: "false" });
  expect(result.content[0].text).toContain("Exit code: 1");
});

test("includes stderr in output on failure", async () => {
  mockResult = { exitCode: 2, stdout: "", stderr: "fail\n" };
  const result = await run({ command: "echo fail >&2; exit 2" });
  expect(result.content[0].text).toContain("fail");
  expect(result.content[0].text).toContain("Exit code: 2");
});
