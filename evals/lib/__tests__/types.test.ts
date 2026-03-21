import { describe, expect, it } from "bun:test";
import { EvalCaseSchema } from "../types.js";

const minimal = {
  id: "test-001",
  input: { messages: [{ role: "user", content: "Hello" }] },
  expected: {},
  grading: "deterministic",
  metadata: { category: "test" },
};

describe("EvalCaseSchema", () => {
  describe("valid cases", () => {
    it("should parse a minimal valid case", () => {
      const result = EvalCaseSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it("should parse a full case with all optional fields", () => {
      const full = {
        id: "full-001",
        input: {
          messages: [
            { role: "user", content: "Hi" },
            { role: "assistant", content: "Hello" },
            { role: "user", content: "Do something" },
          ],
        },
        expected: {
          tools_called: ["query"],
          tools_not_called: ["bash"],
          output_contains: ["balance"],
          output_not_contains: ["error"],
          rubric: "Agent should query the balance",
        },
        grading: "rubric",
        metadata: {
          category: "reasoning",
          tags: ["query", "balance"],
          difficulty: "hard",
          source: "manual",
        },
        setup: {
          memory: { facts: ["Default currency is USD"] },
          ledger: {
            accounts: ["account Assets:Checking"],
            transactions: [["2026-01-01 * Opening", "Assets:Checking  100 USD", "Equity:Opening"]],
          },
        },
      };
      const result = EvalCaseSchema.safeParse(full);
      expect(result.success).toBe(true);
    });

    it("should parse case with setup but no memory", () => {
      const result = EvalCaseSchema.safeParse({
        ...minimal,
        setup: { ledger: { accounts: ["account Assets:Checking"] } },
      });
      expect(result.success).toBe(true);
    });

    it("should parse case with setup but no ledger", () => {
      const result = EvalCaseSchema.safeParse({
        ...minimal,
        setup: { memory: { facts: ["fact1"] } },
      });
      expect(result.success).toBe(true);
    });

    it("should parse case with no setup", () => {
      const result = EvalCaseSchema.safeParse({
        ...minimal,
        setup: undefined,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("defaults", () => {
    it("should default tags to empty array", () => {
      const result = EvalCaseSchema.parse(minimal);
      expect(result.metadata.tags).toEqual([]);
    });

    it("should default difficulty to 'easy'", () => {
      const result = EvalCaseSchema.parse(minimal);
      expect(result.metadata.difficulty).toBe("easy");
    });

    it("should default ledger accounts to empty array", () => {
      const result = EvalCaseSchema.parse({
        ...minimal,
        setup: { ledger: {} },
      });
      expect(result.setup?.ledger?.accounts).toEqual([]);
    });

    it("should default ledger transactions to empty array", () => {
      const result = EvalCaseSchema.parse({
        ...minimal,
        setup: { ledger: {} },
      });
      expect(result.setup?.ledger?.transactions).toEqual([]);
    });
  });

  describe("invalid cases", () => {
    it("should reject missing id", () => {
      const { id: _, ...noId } = minimal;
      const result = EvalCaseSchema.safeParse(noId);
      expect(result.success).toBe(false);
    });

    it("should reject missing input", () => {
      const { input: _, ...noInput } = minimal;
      const result = EvalCaseSchema.safeParse(noInput);
      expect(result.success).toBe(false);
    });

    it("should reject empty messages array", () => {
      const result = EvalCaseSchema.safeParse({
        ...minimal,
        input: { messages: [] },
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid message role", () => {
      const result = EvalCaseSchema.safeParse({
        ...minimal,
        input: { messages: [{ role: "system", content: "hi" }] },
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid grading value", () => {
      const result = EvalCaseSchema.safeParse({
        ...minimal,
        grading: "custom",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid difficulty", () => {
      const result = EvalCaseSchema.safeParse({
        ...minimal,
        metadata: { category: "test", difficulty: "impossible" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing metadata category", () => {
      const result = EvalCaseSchema.safeParse({
        ...minimal,
        metadata: {},
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing expected", () => {
      const { expected: _, ...noExpected } = minimal;
      const result = EvalCaseSchema.safeParse(noExpected);
      expect(result.success).toBe(false);
    });
  });
});
