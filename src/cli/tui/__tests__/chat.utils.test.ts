import { test, expect, describe } from "bun:test";
import type { AppTheme } from "../theme.js";
import {
  SPINNER_FRAMES,
  TOOL_LABELS,
  getToolLabel,
  truncate,
  formatToolSummary,
  renderToolLine,
} from "../chat.utils.js";

const identity = (s: string) => s;
const mockTheme: AppTheme = {
  logo: identity,
  logoTagline: identity,
  userMessage: identity,
  loaderActive: identity,
  loaderInactive: identity,
  toolIcon: identity,
  toolLabel: (s) => `[${s}]`,
  toolArgs: (s) => `(${s})`,
  toolSpinner: identity,
  toolError: (s) => `!${s}!`,
};

describe("SPINNER_FRAMES", () => {
  test("has 10 frames", () => {
    expect(SPINNER_FRAMES).toHaveLength(10);
  });
});

describe("TOOL_LABELS", () => {
  test("maps all tool names", () => {
    expect(TOOL_LABELS.read_file).toBe("Read File");
    expect(TOOL_LABELS.write_file).toBe("Write File");
    expect(TOOL_LABELS.execute).toBe("Execute");
    expect(TOOL_LABELS.validate).toBe("Validate Ledger");
    expect(TOOL_LABELS.query).toBe("Query Ledger");
  });
});

describe("getToolLabel", () => {
  test("returns label for known tool", () => {
    expect(getToolLabel("read_file")).toBe("Read File");
    expect(getToolLabel("query")).toBe("Query Ledger");
  });

  test("falls back to raw name for unknown tool", () => {
    expect(getToolLabel("custom_tool")).toBe("custom_tool");
  });
});

describe("truncate", () => {
  test("returns string unchanged when within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("returns string unchanged at exact limit", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  test("truncates and adds ellipsis when over limit", () => {
    expect(truncate("hello world", 5)).toBe("hell…");
  });

  test("handles empty string", () => {
    expect(truncate("", 5)).toBe("");
  });

  test("handles max of 1", () => {
    expect(truncate("ab", 1)).toBe("…");
  });
});

describe("formatToolSummary", () => {
  test("returns path for read_file", () => {
    expect(formatToolSummary("read_file", { path: "foo.txt" })).toBe("foo.txt");
  });

  test("returns path for write_file", () => {
    expect(formatToolSummary("write_file", { path: "bar.txt" })).toBe("bar.txt");
  });

  test("truncates command for execute", () => {
    const long = "a".repeat(100);
    const result = formatToolSummary("execute", { command: long });
    expect(result).toHaveLength(60);
    expect(result.endsWith("…")).toBe(true);
  });

  test("returns default file for validate with no args", () => {
    expect(formatToolSummary("validate", {})).toBe("ledger/main.beancount");
  });

  test("returns custom file for validate", () => {
    expect(formatToolSummary("validate", { file: "other.bean" })).toBe("other.bean");
  });

  test("truncates query for query tool", () => {
    const long = "SELECT " + "x".repeat(100);
    const result = formatToolSummary("query", { query: long });
    expect(result).toHaveLength(60);
  });

  test("returns empty string for unknown tool", () => {
    expect(formatToolSummary("unknown", { foo: "bar" })).toBe("");
  });

  test("handles null/undefined args", () => {
    expect(formatToolSummary("read_file", null)).toBe("");
    expect(formatToolSummary("read_file", undefined)).toBe("");
  });
});

describe("renderToolLine", () => {
  test("renders icon and label", () => {
    expect(renderToolLine("✓", "Read File", "", mockTheme)).toBe(" ✓ [Read File]");
  });

  test("appends summary when present", () => {
    expect(renderToolLine("✓", "Execute", "ls -la", mockTheme)).toBe(
      " ✓ [Execute]  (ls -la)",
    );
  });

  test("appends error marker when isError is true", () => {
    expect(renderToolLine("✗", "Query", "SELECT 1", mockTheme, true)).toBe(
      " ✗ [Query]  (SELECT 1)  !(error)!",
    );
  });

  test("does not append error marker when isError is false", () => {
    expect(renderToolLine("✓", "Read File", "f.txt", mockTheme, false)).toBe(
      " ✓ [Read File]  (f.txt)",
    );
  });
});
