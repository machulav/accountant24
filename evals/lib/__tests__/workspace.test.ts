import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { EvalCase } from "../types.js";
import { createEvalWorkspace } from "../workspace.js";

const workspacesToCleanup: Array<() => void> = [];
afterAll(() => {
  for (const fn of workspacesToCleanup) fn();
});

function makeCase(overrides?: Partial<EvalCase>): EvalCase {
  return {
    id: "ws-test",
    input: { messages: [{ role: "user", content: "test" }] },
    expected: {},
    grading: "deterministic",
    metadata: { category: "test", tags: [], difficulty: "easy" },
    ...overrides,
  };
}

function createAndTrack(evalCase: EvalCase) {
  const ws = createEvalWorkspace(evalCase);
  workspacesToCleanup.push(ws.cleanup);
  return ws;
}

describe("createEvalWorkspace()", () => {
  describe("directory structure", () => {
    it("should create home directory", () => {
      const ws = createAndTrack(makeCase());
      expect(existsSync(ws.home)).toBe(true);
      expect(statSync(ws.home).isDirectory()).toBe(true);
    });

    it("should create ledger subdirectory", () => {
      const ws = createAndTrack(makeCase());
      expect(existsSync(ws.ledgerDir)).toBe(true);
      expect(statSync(ws.ledgerDir).isDirectory()).toBe(true);
    });

    it("should place ledger inside home", () => {
      const ws = createAndTrack(makeCase());
      expect(ws.ledgerDir).toBe(join(ws.home, "ledger"));
    });

    it("should set memoryPath inside home", () => {
      const ws = createAndTrack(makeCase());
      expect(ws.memoryPath).toBe(join(ws.home, "memory.json"));
    });

    it("should create home inside .workspaces directory", () => {
      const ws = createAndTrack(makeCase());
      expect(ws.home).toContain(".workspaces");
    });

    it("should include case id in home directory name", () => {
      const ws = createAndTrack(makeCase({ id: "my-special-case" }));
      expect(ws.home).toContain("my-special-case");
    });

    it("should create unique directories for same case id", () => {
      const ws1 = createAndTrack(makeCase({ id: "dup-test" }));
      const ws2 = createAndTrack(makeCase({ id: "dup-test" }));
      expect(ws1.home).not.toBe(ws2.home);
    });
  });

  describe("main.journal", () => {
    it("should create empty main.journal when no setup", () => {
      const ws = createAndTrack(makeCase());
      const content = readFileSync(join(ws.ledgerDir, "main.journal"), "utf-8");
      expect(content).toBe("");
    });

    it("should create empty main.journal when setup has empty ledger", () => {
      const ws = createAndTrack(makeCase({ setup: { ledger: { accounts: [], transactions: [] } } }));
      const content = readFileSync(join(ws.ledgerDir, "main.journal"), "utf-8");
      expect(content).toBe("");
    });

    it("should write accounts to main.journal", () => {
      const ws = createAndTrack(
        makeCase({
          setup: {
            ledger: {
              accounts: ["account Assets:Checking", "account Expenses:Food"],
              transactions: [],
            },
          },
        }),
      );
      const content = readFileSync(join(ws.ledgerDir, "main.journal"), "utf-8");
      expect(content).toBe("account Assets:Checking\naccount Expenses:Food\n");
    });

    it("should write transactions with indented postings", () => {
      const ws = createAndTrack(
        makeCase({
          setup: {
            ledger: {
              accounts: [],
              transactions: [["2026-03-01 * Opening", "Assets:Checking  100 USD", "Equity:Opening"]],
            },
          },
        }),
      );
      const content = readFileSync(join(ws.ledgerDir, "main.journal"), "utf-8");
      expect(content).toBe("2026-03-01 * Opening\n    Assets:Checking  100 USD\n    Equity:Opening\n");
    });

    it("should separate multiple transactions with blank lines", () => {
      const ws = createAndTrack(
        makeCase({
          setup: {
            ledger: {
              accounts: [],
              transactions: [
                ["2026-01-01 * Tx1", "A  10 USD", "B"],
                ["2026-02-01 * Tx2", "C  20 USD", "D"],
              ],
            },
          },
        }),
      );
      const content = readFileSync(join(ws.ledgerDir, "main.journal"), "utf-8");
      expect(content).toContain("2026-01-01 * Tx1\n    A  10 USD\n    B\n\n2026-02-01 * Tx2");
    });

    it("should separate accounts and transactions with a blank line", () => {
      const ws = createAndTrack(
        makeCase({
          setup: {
            ledger: {
              accounts: ["account Assets:Checking"],
              transactions: [["2026-01-01 * Tx", "Assets:Checking  100 USD", "Equity:Opening"]],
            },
          },
        }),
      );
      const content = readFileSync(join(ws.ledgerDir, "main.journal"), "utf-8");
      const lines = content.split("\n");
      // accounts line, blank separator, transaction header
      expect(lines[0]).toBe("account Assets:Checking");
      expect(lines[1]).toBe("");
      expect(lines[2]).toBe("2026-01-01 * Tx");
    });
  });

  describe("memory.json", () => {
    it("should write memory.json when memory is provided", () => {
      const ws = createAndTrack(
        makeCase({
          setup: { memory: { facts: ["Default currency is EUR", "Landlord is John"] } },
        }),
      );
      expect(existsSync(ws.memoryPath)).toBe(true);
      const content = JSON.parse(readFileSync(ws.memoryPath, "utf-8"));
      expect(content.facts).toEqual(["Default currency is EUR", "Landlord is John"]);
    });

    it("should write memory with empty facts array", () => {
      const ws = createAndTrack(makeCase({ setup: { memory: { facts: [] } } }));
      expect(existsSync(ws.memoryPath)).toBe(true);
      const content = JSON.parse(readFileSync(ws.memoryPath, "utf-8"));
      expect(content.facts).toEqual([]);
    });

    it("should NOT write memory.json when no memory in setup", () => {
      const ws = createAndTrack(makeCase({ setup: { ledger: { accounts: [], transactions: [] } } }));
      expect(existsSync(ws.memoryPath)).toBe(false);
    });

    it("should NOT write memory.json when no setup at all", () => {
      const ws = createAndTrack(makeCase());
      expect(existsSync(ws.memoryPath)).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("should remove home directory on cleanup", () => {
      const ws = createEvalWorkspace(makeCase({ id: "cleanup-test" }));
      expect(existsSync(ws.home)).toBe(true);
      ws.cleanup();
      expect(existsSync(ws.home)).toBe(false);
    });

    it("should remove all nested files on cleanup", () => {
      const ws = createEvalWorkspace(
        makeCase({
          id: "cleanup-deep",
          setup: {
            memory: { facts: ["test"] },
            ledger: {
              accounts: ["account A"],
              transactions: [["2026-01-01 * X", "A  1 USD", "B"]],
            },
          },
        }),
      );
      const journalPath = join(ws.ledgerDir, "main.journal");
      expect(existsSync(journalPath)).toBe(true);
      expect(existsSync(ws.memoryPath)).toBe(true);
      ws.cleanup();
      expect(existsSync(journalPath)).toBe(false);
      expect(existsSync(ws.memoryPath)).toBe(false);
    });
  });
});
