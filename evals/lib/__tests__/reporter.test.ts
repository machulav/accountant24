import { describe, expect, it } from "bun:test";
import { formatResults } from "../reporter.js";
import type { EvalResult } from "../types.js";

function makeResult(overrides: Partial<EvalResult> & { id: string }): EvalResult {
  return {
    passed: true,
    checks: [],
    toolsCalled: [],
    agentOutput: "",
    durationMs: 100,
    sourceFile: "cases.jsonl",
    ...overrides,
  };
}

describe("formatResults()", () => {
  it("should show correct pass/total count", () => {
    const results = [
      makeResult({ id: "test-a-001", passed: true }),
      makeResult({ id: "test-b-001", passed: false }),
      makeResult({ id: "test-c-001", passed: true }),
    ];
    const output = formatResults(results);
    expect(output).toContain("2/3 passed");
  });

  it("should show 0/N when all fail", () => {
    const results = [makeResult({ id: "test-a-001", passed: false }), makeResult({ id: "test-b-001", passed: false })];
    const output = formatResults(results);
    expect(output).toContain("0/2 passed");
  });

  it("should show N/N when all pass", () => {
    const results = [makeResult({ id: "test-a-001", passed: true }), makeResult({ id: "test-b-001", passed: true })];
    const output = formatResults(results);
    expect(output).toContain("2/2 passed");
  });

  it("should list failed results with check details", () => {
    const results = [
      makeResult({
        id: "tool-selection-001",
        passed: false,
        checks: [
          { check: "tools_called: query", passed: false, detail: '"query" was NOT called' },
          { check: "tools_not_called: bash", passed: true, detail: "correctly not called" },
        ],
        durationMs: 450,
      }),
    ];
    const output = formatResults(results);
    expect(output).toContain("tool-selection-001");
    expect(output).toContain("450ms");
    expect(output).toContain("tools_called: query");
    expect(output).toContain('"query" was NOT called');
  });

  it("should not include passing checks in failure details", () => {
    const results = [
      makeResult({
        id: "test-001",
        passed: false,
        checks: [
          { check: "tools_called: query", passed: true, detail: "called" },
          { check: "tools_called: validate", passed: false, detail: "NOT called" },
        ],
      }),
    ];
    const output = formatResults(results);
    expect(output).toContain("tools_called: validate");
    // The passing check should not appear in the FAILED section's detail lines
    const failedSection = output.split("PASSED")[0];
    expect(failedSection).not.toContain("[tools_called: query] called");
  });

  it("should list passed results with id and duration in ms", () => {
    const results = [makeResult({ id: "test-pass-001", passed: true, durationMs: 200 })];
    const output = formatResults(results);
    expect(output).toContain("test-pass-001");
    expect(output).toContain("200ms");
  });

  it("should format duration in seconds when >= 1000ms", () => {
    const results = [makeResult({ id: "test-slow-001", passed: true, durationMs: 2500 })];
    const output = formatResults(results);
    expect(output).toContain("2.5s");
  });

  it("should include error message for failed results", () => {
    const results = [
      makeResult({
        id: "test-error-001",
        passed: false,
        error: "Connection timeout",
      }),
    ];
    const output = formatResults(results);
    expect(output).toContain("error: Connection timeout");
  });

  it("should group results by category (first two id segments)", () => {
    const results = [
      makeResult({ id: "tool-selection-001", passed: true }),
      makeResult({ id: "tool-selection-002", passed: true }),
      makeResult({ id: "multi-step-001", passed: false }),
    ];
    const output = formatResults(results);
    expect(output).toContain("tool-selection");
    expect(output).toContain("2/2");
    expect(output).toContain("multi-step");
    expect(output).toContain("0/1");
  });

  it("should show checkmark for fully-passed categories", () => {
    const results = [
      makeResult({ id: "tool-selection-001", passed: true }),
      makeResult({ id: "tool-selection-002", passed: true }),
    ];
    const output = formatResults(results);
    // Category line should contain the pass icon
    const categoryLine = output.split("\n").find((l) => l.includes("tool-selection")) ?? "";
    expect(categoryLine).toContain("✓");
  });

  it("should show cross for partially-failed categories", () => {
    const results = [
      makeResult({ id: "tool-selection-001", passed: true }),
      makeResult({ id: "tool-selection-002", passed: false }),
    ];
    const output = formatResults(results);
    const categoryLine = output.split("\n").find((l) => l.includes("tool-selection")) ?? "";
    expect(categoryLine).toContain("✗");
  });

  it("should handle empty results array", () => {
    const output = formatResults([]);
    expect(output).toContain("0/0 passed");
  });

  it("should handle results with no checks", () => {
    const results = [makeResult({ id: "test-empty-001", passed: true, checks: [] })];
    const output = formatResults(results);
    expect(output).toContain("1/1 passed");
  });

  describe("BY SOURCE FILE section", () => {
    it("should group results by sourceFile", () => {
      const results = [
        makeResult({ id: "test-a-001", passed: true, sourceFile: "transactions.jsonl" }),
        makeResult({ id: "test-a-002", passed: true, sourceFile: "transactions.jsonl" }),
        makeResult({ id: "test-b-001", passed: false, sourceFile: "queries.jsonl" }),
      ];
      const output = formatResults(results);
      expect(output).toContain("BY SOURCE FILE");
      expect(output).toContain("transactions.jsonl");
      expect(output).toContain("queries.jsonl");
    });

    it("should show checkmark for files where all cases pass", () => {
      const results = [
        makeResult({ id: "test-a-001", passed: true, sourceFile: "good.jsonl" }),
        makeResult({ id: "test-a-002", passed: true, sourceFile: "good.jsonl" }),
      ];
      const output = formatResults(results);
      const fileLine = output.split("\n").find((l) => l.includes("good.jsonl")) ?? "";
      expect(fileLine).toContain("✓");
    });

    it("should show cross for files with any failure", () => {
      const results = [
        makeResult({ id: "test-a-001", passed: true, sourceFile: "mixed.jsonl" }),
        makeResult({ id: "test-a-002", passed: false, sourceFile: "mixed.jsonl" }),
      ];
      const output = formatResults(results);
      const fileLine = output.split("\n").find((l) => l.includes("mixed.jsonl")) ?? "";
      expect(fileLine).toContain("✗");
    });

    it("should show correct counts per file", () => {
      const results = [
        makeResult({ id: "test-a-001", passed: true, sourceFile: "a.jsonl" }),
        makeResult({ id: "test-a-002", passed: false, sourceFile: "a.jsonl" }),
        makeResult({ id: "test-b-001", passed: true, sourceFile: "b.jsonl" }),
      ];
      const output = formatResults(results);
      const aLine = output.split("\n").find((l) => l.includes("a.jsonl"));
      const bLine = output.split("\n").find((l) => l.includes("b.jsonl"));
      expect(aLine).toContain("1/2");
      expect(bLine).toContain("1/1");
    });

    it("should fall back to 'unknown' when sourceFile is missing", () => {
      const results = [makeResult({ id: "test-a-001", passed: true, sourceFile: undefined })];
      const output = formatResults(results);
      expect(output).toContain("unknown");
    });
  });

  describe("model options", () => {
    it("should display eval model when evalModel is provided", () => {
      const results = [makeResult({ id: "test-a-001" })];
      const output = formatResults(results, { evalModel: "gpt-4", evalProvider: "openai" });
      expect(output).toContain("eval model   openai/gpt-4");
    });

    it("should display judge model when judgeModel is provided", () => {
      const results = [makeResult({ id: "test-a-001" })];
      const output = formatResults(results, { judgeModel: "claude-3", judgeProvider: "anthropic" });
      expect(output).toContain("judge model  anthropic/claude-3");
    });

    it("should display both model lines when both provided", () => {
      const results = [makeResult({ id: "test-a-001" })];
      const output = formatResults(results, {
        evalModel: "gpt-4",
        evalProvider: "openai",
        judgeModel: "claude-3",
        judgeProvider: "anthropic",
      });
      expect(output).toContain("eval model   openai/gpt-4");
      expect(output).toContain("judge model  anthropic/claude-3");
    });

    it("should not display model section when options is empty object", () => {
      const results = [makeResult({ id: "test-a-001" })];
      const output = formatResults(results, {});
      expect(output).not.toContain("eval model");
      expect(output).not.toContain("judge model");
    });

    it("should use empty string for evalProvider when not provided", () => {
      const results = [makeResult({ id: "test-a-001" })];
      const output = formatResults(results, { evalModel: "gpt-4" });
      expect(output).toContain("eval model   /gpt-4");
    });

    it("should use empty string for judgeProvider when not provided", () => {
      const results = [makeResult({ id: "test-a-001" })];
      const output = formatResults(results, { judgeModel: "claude-3" });
      expect(output).toContain("judge model  /claude-3");
    });

    it("should show only evalModel line when judgeModel is not provided", () => {
      const results = [makeResult({ id: "test-a-001" })];
      const output = formatResults(results, { evalModel: "gpt-4", evalProvider: "openai" });
      expect(output).toContain("eval model");
      expect(output).not.toContain("judge model");
    });

    it("should show only judgeModel line when evalModel is not provided", () => {
      const results = [makeResult({ id: "test-a-001" })];
      const output = formatResults(results, { judgeModel: "claude-3", judgeProvider: "anthropic" });
      expect(output).not.toContain("eval model");
      expect(output).toContain("judge model");
    });
  });
});
