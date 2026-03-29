import { describe, expect, it } from "bun:test";
import { gradeDeterministic, gradeOutcome } from "../grader";
import type { WorkspaceState } from "../workspace";
import { makeCase as _makeCase, makeTool } from "./helpers";

const makeCase = (expected: Parameters<typeof _makeCase>[0]["expected"]) => _makeCase({ expected });

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

describe("gradeOutcome()", () => {
  const ledger = `account Assets:Checking
account Expenses:Food:Coffee

2026-03-20 * Starbucks | Latte
    Expenses:Food:Coffee  5.00 EUR
    Assets:Checking

2026-03-21 * Rewe | Weekly groceries
    Expenses:Food:Groceries  42.50 EUR
    Assets:Checking`;

  function makeState(overrides?: Partial<WorkspaceState>): WorkspaceState {
    return { ledgerContent: ledger, memoryContent: "", ...overrides };
  }

  describe("ledger_contains", () => {
    it("should pass when ledger contains expected transaction", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Starbucks" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks).toHaveLength(1);
      expect(checks[0].passed).toBe(true);
    });

    it("should fail when ledger does not contain expected transaction", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Amazon" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks).toHaveLength(1);
      expect(checks[0].passed).toBe(false);
    });

    it("should match payee case-insensitively", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "starbucks" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(true);
    });

    it("should check amount when specified", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Starbucks", amount: 5 }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(true);
    });

    it("should fail when amount does not match", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Starbucks", amount: 99 }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(false);
    });

    it("should check currency when specified", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Starbucks", currency: "EUR" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(true);
    });

    it("should fail when currency does not match", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Starbucks", currency: "USD" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(false);
    });

    it("should check account when specified", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Starbucks", account: "Expenses:Food:Coffee" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(true);
    });

    it("should match account as substring", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Rewe", account: "Groceries" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(true);
    });

    it("should check date when specified", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Starbucks", date: "2026-03-20" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(true);
    });

    it("should fail when date does not match", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Starbucks", date: "2026-03-21" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(false);
    });

    it("should check narration when specified", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Starbucks", narration: "Latte" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(true);
    });

    it("should check all fields together", () => {
      const evalCase = makeCase({
        ledger_contains: [
          {
            payee: "Rewe",
            amount: 42.5,
            currency: "EUR",
            account: "Groceries",
            date: "2026-03-21",
            narration: "Weekly",
          },
        ],
      });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(true);
    });

    it("should check multiple assertions independently", () => {
      const evalCase = makeCase({
        ledger_contains: [{ payee: "Starbucks" }, { payee: "Amazon" }],
      });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks).toHaveLength(2);
      expect(checks[0].passed).toBe(true);
      expect(checks[1].passed).toBe(false);
    });
  });

  describe("ledger_not_contains", () => {
    it("should pass when transaction is absent", () => {
      const evalCase = makeCase({ ledger_not_contains: [{ payee: "Amazon" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(true);
    });

    it("should fail when transaction is present", () => {
      const evalCase = makeCase({ ledger_not_contains: [{ payee: "Starbucks" }] });
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks[0].passed).toBe(false);
    });
  });

  describe("memory_contains", () => {
    it("should pass when text is present in memory", () => {
      const evalCase = makeCase({ memory_contains: ["Peterson"] });
      const state = makeState({ memoryContent: "- Mr. Peterson is the math tutor" });
      const checks = gradeOutcome(evalCase, state);
      expect(checks[0].passed).toBe(true);
    });

    it("should fail when text is absent from memory", () => {
      const evalCase = makeCase({ memory_contains: ["Peterson"] });
      const state = makeState({ memoryContent: "- Default currency is EUR" });
      const checks = gradeOutcome(evalCase, state);
      expect(checks[0].passed).toBe(false);
    });

    it("should match case-insensitively", () => {
      const evalCase = makeCase({ memory_contains: ["peterson"] });
      const state = makeState({ memoryContent: "- Mr. Peterson is the tutor" });
      const checks = gradeOutcome(evalCase, state);
      expect(checks[0].passed).toBe(true);
    });
  });

  describe("empty assertions", () => {
    it("should return empty checks when no outcome assertions defined", () => {
      const evalCase = makeCase({});
      const checks = gradeOutcome(evalCase, makeState());
      expect(checks).toEqual([]);
    });

    it("should return empty checks for empty ledger content", () => {
      const evalCase = makeCase({ ledger_contains: [{ payee: "Starbucks" }] });
      const checks = gradeOutcome(evalCase, makeState({ ledgerContent: "" }));
      expect(checks[0].passed).toBe(false);
    });
  });
});
