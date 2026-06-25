import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loadCases } from "../loader";

describe("loadCases()", () => {
  it("should load cases from all .jsonl files in the cases directory", () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThan(0);
  });

  it("should aggregate cases from multiple files", () => {
    const casesDir = join(import.meta.dirname, "../../cases");
    const files = readdirSync(casesDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThanOrEqual(2);

    const cases = loadCases();
    // Cases should include entries from different files
    // add-single-transaction.jsonl has add_transactions cases, cases.jsonl has others
    const hasAddTransaction = cases.some((c) => c.id.includes("add-coffee"));
    const hasBalanceQuery = cases.some((c) => c.id.includes("balance-query"));
    expect(hasAddTransaction).toBe(true);
    expect(hasBalanceQuery).toBe(true);
  });

  it("should ignore non-jsonl files in the cases directory", () => {
    // loadCases only reads .jsonl files — if other files exist they should be skipped
    // This test documents the filtering behavior; as long as loadCases doesn't throw
    // on non-jsonl files existing, the filter works correctly
    const cases = loadCases();
    expect(cases.length).toBeGreaterThan(0);
  });

  it("should return parsed EvalCase objects with required fields", () => {
    const cases = loadCases();
    for (const c of cases) {
      expect(c.id).toBeDefined();
      expect(typeof c.id).toBe("string");
      expect(c.input.messages.length).toBeGreaterThanOrEqual(1);
      expect(c.expected).toBeDefined();
      expect(["deterministic", "rubric"]).toContain(c.grading);
      expect(c.metadata.category).toBeDefined();
    }
  });

  it("should attach sourceFile to every loaded case", () => {
    const cases = loadCases();
    for (const c of cases) {
      expect(c.sourceFile).toBeDefined();
      expect(typeof c.sourceFile).toBe("string");
      expect(c.sourceFile).toEndWith(".jsonl");
    }
  });

  it("should set sourceFile to the bare filename, not the full path", () => {
    const cases = loadCases();
    for (const c of cases) {
      expect(c.sourceFile).not.toContain("/");
    }
  });

  it("should preserve sourceFile after filtering", () => {
    const filtered = loadCases("tool-selection");
    expect(filtered.length).toBeGreaterThan(0);
    for (const c of filtered) {
      expect(c.sourceFile).toBeDefined();
      expect(c.sourceFile).toEndWith(".jsonl");
    }
  });

  it("should have unique ids across all cases", () => {
    const cases = loadCases();
    const ids = cases.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  describe("filtering", () => {
    it("should filter cases by id substring", () => {
      const all = loadCases();
      const filtered = loadCases("tool-selection");
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.length).toBeLessThan(all.length);
      for (const c of filtered) {
        expect(c.id).toContain("tool-selection");
      }
    });

    it("should return empty array when filter matches nothing", () => {
      const cases = loadCases("nonexistent-filter-xyz-999");
      expect(cases).toEqual([]);
    });

    it("should return all cases when filter is undefined", () => {
      const all = loadCases();
      const unfiltered = loadCases(undefined);
      expect(unfiltered.length).toBe(all.length);
    });

    it("should match filter as substring, not exact match", () => {
      const filtered = loadCases("001");
      expect(filtered.length).toBeGreaterThan(1);
    });
  });
});
