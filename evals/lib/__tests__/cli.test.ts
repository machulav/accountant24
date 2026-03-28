import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import chalk from "chalk";
import type { EvalResult } from "../types.js";
import { makeResult } from "./helpers.js";

// ── Mutable control variables ───────────────────────────────────────

let mockRunEvalResult: EvalResult[] = [];
let capturedRunEvalConfig: any;

// ── Mock runner and reporter ────────────────────────────────────────

mock.module("../runner.js", () => ({
  runEval: async (config: any) => {
    capturedRunEvalConfig = config;
    return mockRunEvalResult;
  },
}));

mock.module("../reporter.js", () => ({
  formatResults: () => "MOCK_REPORT",
}));

const { formatDuration, formatTableRow, renderTable, createProgressHandler, main } = await import("../cli.js");

const defaultConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  judgeProvider: "anthropic",
  judgeModel: "claude-sonnet-4-6",
};

// ── Reset ───────────────────────────────────────────────────────────

beforeEach(() => {
  mockRunEvalResult = [];
  capturedRunEvalConfig = undefined;
});

// ── Tests ───────────────────────────────────────────────────────────

describe("formatDuration()", () => {
  it("should return milliseconds when < 1000", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("should return seconds when >= 1000", () => {
    expect(formatDuration(2500)).toBe("2.5s");
  });

  it("should return 0ms for zero", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  it("should return 1.0s for exactly 1000ms", () => {
    expect(formatDuration(1000)).toBe("1.0s");
  });
});

describe("formatTableRow()", () => {
  it("should show yellow dots for running status", () => {
    const row = { index: 0, total: 3, id: "test-001", status: "running" as const };
    const output = formatTableRow(row, row.id.length);
    expect(output).toContain("[1/3]");
    expect(output).toContain("test-001");
    expect(output).toContain(chalk.yellow("..."));
  });

  it("should show green PASS with duration for pass status", () => {
    const row = { index: 1, total: 5, id: "test-002", status: "pass" as const, durationMs: 200 };
    const output = formatTableRow(row, row.id.length);
    expect(output).toContain("[2/5]");
    expect(output).toContain("test-002");
    expect(output).toContain(chalk.green("PASS"));
    expect(output).toContain(chalk.dim("200ms"));
  });

  it("should show red FAIL with duration for fail status", () => {
    const row = { index: 2, total: 5, id: "test-003", status: "fail" as const, durationMs: 3000 };
    const output = formatTableRow(row, row.id.length);
    expect(output).toContain("[3/5]");
    expect(output).toContain("test-003");
    expect(output).toContain(chalk.red("FAIL"));
    expect(output).toContain(chalk.dim("3.0s"));
  });

  it("should handle pass without durationMs", () => {
    const row = { index: 0, total: 1, id: "test", status: "pass" as const };
    const output = formatTableRow(row, row.id.length);
    expect(output).toContain(chalk.green("PASS"));
  });
});

describe("renderTable()", () => {
  it("should render header with total count", () => {
    const output = renderTable([], 5);
    expect(output).toContain("Running 5 eval(s)");
  });

  it("should render all rows", () => {
    const rows = [
      { index: 0, total: 2, id: "a", status: "pass" as const, durationMs: 100 },
      { index: 1, total: 2, id: "b", status: "running" as const },
    ];
    const output = renderTable(rows, 2);
    expect(output).toContain("a");
    expect(output).toContain("b");
    expect(output).toContain(chalk.green("PASS"));
    expect(output).toContain(chalk.yellow("..."));
  });

  it("should include model label when provided", () => {
    const output = renderTable([], 3, "anthropic/claude-sonnet-4-6");
    expect(output).toContain("anthropic/claude-sonnet-4-6");
  });

  it("should not include 'with' when no model label", () => {
    const output = renderTable([], 3);
    expect(output).not.toContain("with");
  });
});

describe("createProgressHandler()", () => {
  it("should not write to stdout on start event", () => {
    const handler = createProgressHandler();
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      handler({ type: "start", total: 5 });
      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("should write table on case_start event", () => {
    const handler = createProgressHandler();
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      handler({ type: "start", total: 3 });
      handler({ type: "case_start", index: 0, total: 3, id: "test-001" });
      expect(writeSpy).toHaveBeenCalled();
      const output = writeSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("test-001");
      expect(output).toContain(chalk.yellow("..."));
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("should update row and rewrite table on case_end event", () => {
    const handler = createProgressHandler();
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      handler({ type: "start", total: 1 });
      handler({ type: "case_start", index: 0, total: 1, id: "test-001" });
      writeSpy.mockClear();
      handler({ type: "case_end", index: 0, total: 1, id: "test-001", passed: true, durationMs: 500 });
      const output = writeSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain(chalk.green("PASS"));
      expect(output).toContain(chalk.dim("500ms"));
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("should show FAIL for failed case_end", () => {
    const handler = createProgressHandler();
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      handler({ type: "start", total: 1 });
      handler({ type: "case_start", index: 0, total: 1, id: "fail-001" });
      writeSpy.mockClear();
      handler({ type: "case_end", index: 0, total: 1, id: "fail-001", passed: false, durationMs: 2000 });
      const output = writeSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain(chalk.red("FAIL"));
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("should include model label in table output", () => {
    const handler = createProgressHandler("openai/gpt-5");
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      handler({ type: "start", total: 1 });
      handler({ type: "case_start", index: 0, total: 1, id: "test-001" });
      const output = writeSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("openai/gpt-5");
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe("main()", () => {
  it("should return exitCode 0 when all results pass", async () => {
    mockRunEvalResult = [makeResult({ id: "pass-001", passed: true })];
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const { exitCode } = await main(defaultConfig);
      expect(exitCode).toBe(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("should return exitCode 1 when any result fails", async () => {
    mockRunEvalResult = [makeResult({ id: "pass-001", passed: true }), makeResult({ id: "fail-001", passed: false })];
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { exitCode } = await main(defaultConfig);
      expect(exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith("\n1 eval(s) failed.");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("should log formatted results when results exist", async () => {
    mockRunEvalResult = [makeResult({ id: "test-001", passed: true })];
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(defaultConfig);
      expect(logSpy).toHaveBeenCalledWith("MOCK_REPORT");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("should not log when results are empty", async () => {
    mockRunEvalResult = [];
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(defaultConfig);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("should pass config and onProgress to runEval", async () => {
    mockRunEvalResult = [];
    await main({ ...defaultConfig, filter: "my-filter" });
    expect(capturedRunEvalConfig.provider).toBe("anthropic");
    expect(capturedRunEvalConfig.model).toBe("claude-sonnet-4-6");
    expect(capturedRunEvalConfig.filter).toBe("my-filter");
    expect(typeof capturedRunEvalConfig.onProgress).toBe("function");
  });
});
