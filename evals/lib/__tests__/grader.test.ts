import { describe, expect, it } from "bun:test";
import { gradeDeterministic } from "../grader.js";
import type { EvalCase, ToolCallRecord } from "../types.js";

function makeCase(expected: EvalCase["expected"]): EvalCase {
  return {
    id: "test-001",
    input: { messages: [{ role: "user", content: "test" }] },
    expected,
    grading: "deterministic",
    metadata: { category: "test", tags: [], difficulty: "easy" },
  };
}

function makeTool(name: string): ToolCallRecord {
  return { toolCallId: `id-${name}`, toolName: name, args: {}, result: {}, isError: false };
}

describe("gradeDeterministic()", () => {
  describe("tools_called", () => {
    it("should pass when expected tool was called", () => {
      const evalCase = makeCase({ tools_called: ["query"] });
      const tools = [makeTool("query")];
      const checks = gradeDeterministic(evalCase, tools, "");
      expect(checks).toHaveLength(1);
      expect(checks[0].passed).toBe(true);
      expect(checks[0].check).toBe("tools_called: query");
    });

    it("should fail when expected tool was NOT called", () => {
      const evalCase = makeCase({ tools_called: ["query"] });
      const checks = gradeDeterministic(evalCase, [], "");
      expect(checks).toHaveLength(1);
      expect(checks[0].passed).toBe(false);
      expect(checks[0].detail).toContain("NOT called");
    });

    it("should pass when multiple expected tools are all called", () => {
      const evalCase = makeCase({ tools_called: ["query", "add_transaction"] });
      const tools = [makeTool("query"), makeTool("add_transaction")];
      const checks = gradeDeterministic(evalCase, tools, "");
      expect(checks).toHaveLength(2);
      expect(checks.every((c) => c.passed)).toBe(true);
    });

    it("should fail for missing tool when only some expected tools are called", () => {
      const evalCase = makeCase({ tools_called: ["query", "validate"] });
      const tools = [makeTool("query")];
      const checks = gradeDeterministic(evalCase, tools, "");
      expect(checks[0].passed).toBe(true);
      expect(checks[1].passed).toBe(false);
    });

    it("should deduplicate tool names from calls", () => {
      const evalCase = makeCase({ tools_called: ["query"] });
      const tools = [makeTool("query"), makeTool("query"), makeTool("query")];
      const checks = gradeDeterministic(evalCase, tools, "");
      expect(checks).toHaveLength(1);
      expect(checks[0].passed).toBe(true);
    });

    it("should list actually called tools in failure detail", () => {
      const evalCase = makeCase({ tools_called: ["validate"] });
      const tools = [makeTool("query"), makeTool("bash")];
      const checks = gradeDeterministic(evalCase, tools, "");
      expect(checks[0].detail).toContain("query");
      expect(checks[0].detail).toContain("bash");
    });
  });

  describe("tools_not_called", () => {
    it("should pass when forbidden tool was NOT called", () => {
      const evalCase = makeCase({ tools_not_called: ["bash"] });
      const tools = [makeTool("query")];
      const checks = gradeDeterministic(evalCase, tools, "");
      expect(checks).toHaveLength(1);
      expect(checks[0].passed).toBe(true);
    });

    it("should fail when forbidden tool WAS called", () => {
      const evalCase = makeCase({ tools_not_called: ["bash"] });
      const tools = [makeTool("bash")];
      const checks = gradeDeterministic(evalCase, tools, "");
      expect(checks).toHaveLength(1);
      expect(checks[0].passed).toBe(false);
      expect(checks[0].detail).toContain("should NOT");
    });

    it("should pass when no tools were called and some are forbidden", () => {
      const evalCase = makeCase({ tools_not_called: ["bash", "write"] });
      const checks = gradeDeterministic(evalCase, [], "");
      expect(checks).toHaveLength(2);
      expect(checks.every((c) => c.passed)).toBe(true);
    });

    it("should handle multiple forbidden with partial violation", () => {
      const evalCase = makeCase({ tools_not_called: ["bash", "write"] });
      const tools = [makeTool("bash")];
      const checks = gradeDeterministic(evalCase, tools, "");
      expect(checks[0].passed).toBe(false); // bash was called
      expect(checks[1].passed).toBe(true); // write was not called
    });
  });

  describe("output_contains", () => {
    it("should pass when output contains the fragment", () => {
      const evalCase = makeCase({ output_contains: ["balance"] });
      const checks = gradeDeterministic(evalCase, [], "Your balance is $100");
      expect(checks[0].passed).toBe(true);
    });

    it("should fail when output does NOT contain the fragment", () => {
      const evalCase = makeCase({ output_contains: ["balance"] });
      const checks = gradeDeterministic(evalCase, [], "Transaction added");
      expect(checks[0].passed).toBe(false);
    });

    it("should match case-insensitively", () => {
      const evalCase = makeCase({ output_contains: ["BALANCE"] });
      const checks = gradeDeterministic(evalCase, [], "your balance is $100");
      expect(checks[0].passed).toBe(true);
    });

    it("should check multiple fragments independently", () => {
      const evalCase = makeCase({ output_contains: ["balance", "missing"] });
      const checks = gradeDeterministic(evalCase, [], "Your balance is $100");
      expect(checks[0].passed).toBe(true);
      expect(checks[1].passed).toBe(false);
    });

    it("should pass with empty output when checking for empty string", () => {
      const evalCase = makeCase({ output_contains: [""] });
      const checks = gradeDeterministic(evalCase, [], "");
      expect(checks[0].passed).toBe(true);
    });
  });

  describe("output_not_contains", () => {
    it("should pass when output does NOT contain the fragment", () => {
      const evalCase = makeCase({ output_not_contains: ["error"] });
      const checks = gradeDeterministic(evalCase, [], "Transaction added");
      expect(checks[0].passed).toBe(true);
    });

    it("should fail when output contains the fragment", () => {
      const evalCase = makeCase({ output_not_contains: ["rm "] });
      const checks = gradeDeterministic(evalCase, [], "Running rm -rf");
      expect(checks[0].passed).toBe(false);
      expect(checks[0].detail).toContain("should NOT");
    });

    it("should match case-insensitively", () => {
      const evalCase = makeCase({ output_not_contains: ["ERROR"] });
      const checks = gradeDeterministic(evalCase, [], "An error occurred");
      expect(checks[0].passed).toBe(false);
    });
  });

  describe("combined checks", () => {
    it("should return empty array when no expected checks defined", () => {
      const evalCase = makeCase({});
      const checks = gradeDeterministic(evalCase, [makeTool("query")], "some output");
      expect(checks).toEqual([]);
    });

    it("should evaluate all check types together", () => {
      const evalCase = makeCase({
        tools_called: ["query"],
        tools_not_called: ["bash"],
        output_contains: ["balance"],
        output_not_contains: ["error"],
      });
      const tools = [makeTool("query")];
      const checks = gradeDeterministic(evalCase, tools, "Your balance is $100");
      expect(checks).toHaveLength(4);
      expect(checks.every((c) => c.passed)).toBe(true);
    });

    it("should report failures across mixed check types", () => {
      const evalCase = makeCase({
        tools_called: ["validate"],
        tools_not_called: ["bash"],
        output_contains: ["done"],
        output_not_contains: ["error"],
      });
      const tools = [makeTool("bash")];
      const checks = gradeDeterministic(evalCase, tools, "error occurred");
      // validate not called → fail
      expect(checks[0].passed).toBe(false);
      // bash was called → fail
      expect(checks[1].passed).toBe(false);
      // "done" not in output → fail
      expect(checks[2].passed).toBe(false);
      // "error" in output → fail
      expect(checks[3].passed).toBe(false);
    });
  });
});
