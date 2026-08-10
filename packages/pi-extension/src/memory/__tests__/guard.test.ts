import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-guard-"));

vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: join(BASE, "ledger"),
  MEMORY_PATH: join(BASE, "memory.md"),
  setBaseDir: () => {},
}));

const { guardMemoryToolCall } = await import("../guard.js");

function writeEvent(path: string) {
  return { type: "tool_call", toolCallId: "t1", toolName: "write", input: { path, content: "new content" } } as never;
}

function editEvent(path: string) {
  return {
    type: "tool_call",
    toolCallId: "t2",
    toolName: "edit",
    input: { path, edits: [{ oldText: "a", newText: "b" }] },
  } as never;
}

function bashEvent(command: string) {
  return { type: "tool_call", toolCallId: "t3", toolName: "bash", input: { command } } as never;
}

beforeEach(() => {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
});

describe("guardMemoryToolCall()", () => {
  describe("write", () => {
    test("should block a write to memory.md when memory has content", async () => {
      writeFileSync(join(BASE, "memory.md"), "## Defaults\n- currency: EUR\n");
      const result = await guardMemoryToolCall(writeEvent("memory.md"), BASE);
      expect(result).toEqual({ block: true, reason: expect.stringContaining("Do not rewrite it wholesale") });
      expect(result?.reason).toContain("edit tool");
      expect(result?.reason).toContain("<memory> block");
    });

    test("should block a write to the absolute memory path when memory has content", async () => {
      writeFileSync(join(BASE, "memory.md"), "## Defaults\n- currency: EUR\n");
      const result = await guardMemoryToolCall(writeEvent(join(BASE, "memory.md")), BASE);
      expect(result).toEqual({ block: true, reason: expect.any(String) });
    });

    test("should allow the first write when memory.md does not exist", async () => {
      const result = await guardMemoryToolCall(writeEvent("memory.md"), BASE);
      expect(result).toBeUndefined();
    });

    test("should allow the first write when memory.md is empty", async () => {
      writeFileSync(join(BASE, "memory.md"), "");
      const result = await guardMemoryToolCall(writeEvent("memory.md"), BASE);
      expect(result).toBeUndefined();
    });

    test("should allow the first write when memory.md contains only whitespace", async () => {
      writeFileSync(join(BASE, "memory.md"), "  \n \n");
      const result = await guardMemoryToolCall(writeEvent("memory.md"), BASE);
      expect(result).toBeUndefined();
    });

    test("should allow writes to other files when memory has content", async () => {
      writeFileSync(join(BASE, "memory.md"), "## Defaults\n- currency: EUR\n");
      const result = await guardMemoryToolCall(writeEvent("ledger/accounts.journal"), BASE);
      expect(result).toBeUndefined();
    });
  });

  describe("edit", () => {
    test("should allow edits to memory.md", async () => {
      writeFileSync(join(BASE, "memory.md"), "## Defaults\n- currency: EUR\n");
      const result = await guardMemoryToolCall(editEvent("memory.md"), BASE);
      expect(result).toBeUndefined();
    });
  });

  describe("bash", () => {
    test("should block a bash command that mentions memory.md", async () => {
      const result = await guardMemoryToolCall(bashEvent("cat memory.md"), BASE);
      expect(result).toEqual({ block: true, reason: expect.stringContaining("Do not access memory.md with bash") });
      expect(result?.reason).toContain("edit tool");
    });

    test("should block bash access even when memory is empty", async () => {
      const result = await guardMemoryToolCall(bashEvent("echo '- fact' >> memory.md"), BASE);
      expect(result).toEqual({ block: true, reason: expect.any(String) });
    });

    test("should allow bash commands that do not mention memory.md", async () => {
      const result = await guardMemoryToolCall(bashEvent("hledger balance -f ledger/main.journal"), BASE);
      expect(result).toBeUndefined();
    });

    test("should allow bash when command is missing", async () => {
      const event = { type: "tool_call", toolCallId: "t4", toolName: "bash", input: {} } as never;
      const result = await guardMemoryToolCall(event, BASE);
      expect(result).toBeUndefined();
    });
  });

  describe("other tools", () => {
    test("should ignore custom tools even when their input mentions memory.md", async () => {
      const event = {
        type: "tool_call",
        toolCallId: "t5",
        toolName: "query",
        input: { command: "balance memory.md" },
      } as never;
      const result = await guardMemoryToolCall(event, BASE);
      expect(result).toBeUndefined();
    });

    test("should ignore read calls on memory.md", async () => {
      const event = {
        type: "tool_call",
        toolCallId: "t6",
        toolName: "read",
        input: { path: "memory.md" },
      } as never;
      const result = await guardMemoryToolCall(event, BASE);
      expect(result).toBeUndefined();
    });
  });
});
