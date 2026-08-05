import { describe, expect, it } from "vitest";
import { isMemoryReadCall, isMemoryUpdateCall } from "../memory-tool";

describe("isMemoryUpdateCall()", () => {
  it("should return true for an edit call targeting memory.md", () => {
    expect(isMemoryUpdateCall("edit", { path: "memory.md", edits: [] })).toBe(true);
  });

  it("should return true for a write call targeting memory.md", () => {
    expect(isMemoryUpdateCall("write", { path: "memory.md", content: "x" })).toBe(true);
  });

  it("should return true for an absolute path ending in /memory.md", () => {
    expect(isMemoryUpdateCall("edit", { path: "/Users/someone/Accountant24/memory.md" })).toBe(true);
  });

  it("should return true for a backslash path ending in memory.md", () => {
    expect(isMemoryUpdateCall("edit", { path: "C:\\Accountant24\\memory.md" })).toBe(true);
  });

  it("should return false for edits of other files", () => {
    expect(isMemoryUpdateCall("edit", { path: "ledger/main.journal", edits: [] })).toBe(false);
  });

  it("should return false for a file whose name merely ends in memory.md", () => {
    expect(isMemoryUpdateCall("edit", { path: "somememory.md" })).toBe(false);
    expect(isMemoryUpdateCall("edit", { path: "files/oldmemory.md" })).toBe(false);
  });

  it("should return false for non-file tools even when the path matches", () => {
    expect(isMemoryUpdateCall("read", { path: "memory.md" })).toBe(false);
    expect(isMemoryUpdateCall("query", { path: "memory.md" })).toBe(false);
  });

  it("should return false while args are missing or partial (streaming)", () => {
    expect(isMemoryUpdateCall("edit", undefined)).toBe(false);
    expect(isMemoryUpdateCall("edit", null)).toBe(false);
    expect(isMemoryUpdateCall("edit", {})).toBe(false);
    expect(isMemoryUpdateCall("edit", { path: 42 })).toBe(false);
  });

  it("should accept the legacy file_path argument name", () => {
    expect(isMemoryUpdateCall("edit", { file_path: "memory.md" })).toBe(true);
  });
});

describe("isMemoryReadCall()", () => {
  it("should return true for a read call targeting memory.md", () => {
    expect(isMemoryReadCall("read", { path: "memory.md" })).toBe(true);
  });

  it("should return true for an absolute path ending in /memory.md", () => {
    expect(isMemoryReadCall("read", { path: "/Users/someone/Accountant24/memory.md" })).toBe(true);
  });

  it("should return false for reads of other files", () => {
    expect(isMemoryReadCall("read", { path: "ledger/main.journal" })).toBe(false);
    expect(isMemoryReadCall("read", { path: "skills/x/SKILL.md" })).toBe(false);
  });

  it("should return false for edit and write calls", () => {
    expect(isMemoryReadCall("edit", { path: "memory.md" })).toBe(false);
    expect(isMemoryReadCall("write", { path: "memory.md" })).toBe(false);
  });

  it("should return false while args are missing or partial (streaming)", () => {
    expect(isMemoryReadCall("read", undefined)).toBe(false);
    expect(isMemoryReadCall("read", {})).toBe(false);
  });
});
