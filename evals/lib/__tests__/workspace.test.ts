import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEvalWorkspace, inspectWorkspace } from "../workspace.js";
import { makeCase as _makeCase } from "./helpers.js";

const workspacesToCleanup: Array<() => void> = [];
afterAll(() => {
  for (const fn of workspacesToCleanup) fn();
});

const makeCase = (overrides?: Parameters<typeof _makeCase>[0]) => _makeCase({ id: "ws-test", ...overrides });

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
      expect(ws.memoryPath).toBe(join(ws.home, "memory.md"));
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

  describe("memory.md", () => {
    it("should write memory.md when memory is provided", () => {
      const ws = createAndTrack(
        makeCase({
          setup: { memory: "- Default currency is EUR\n- Landlord is John" },
        }),
      );
      expect(existsSync(ws.memoryPath)).toBe(true);
      const content = readFileSync(ws.memoryPath, "utf-8");
      expect(content).toContain("- Default currency is EUR");
      expect(content).toContain("- Landlord is John");
    });

    it("should NOT write memory.md when no memory in setup", () => {
      const ws = createAndTrack(makeCase({ setup: { ledger: { accounts: [], transactions: [] } } }));
      expect(existsSync(ws.memoryPath)).toBe(false);
    });

    it("should NOT write memory.md when no setup at all", () => {
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
            memory: "- test",
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

describe("inspectWorkspace()", () => {
  describe("ledger content", () => {
    it("should return empty string when ledger has no content", () => {
      const ws = createAndTrack(makeCase());
      const state = inspectWorkspace(ws);
      expect(state.ledgerContent).toBe("");
    });

    it("should read main.journal content", () => {
      const ws = createAndTrack(
        makeCase({
          setup: {
            ledger: {
              accounts: ["account Assets:Checking"],
              transactions: [["2026-03-01 * Starbucks | Coffee", "Expenses:Food  5.00 EUR", "Assets:Checking"]],
            },
          },
        }),
      );
      const state = inspectWorkspace(ws);
      expect(state.ledgerContent).toContain("Starbucks");
      expect(state.ledgerContent).toContain("5.00 EUR");
    });

    it("should read monthly journal files in subdirectories", () => {
      const ws = createAndTrack(makeCase());
      const monthDir = join(ws.ledgerDir, "2026", "03");
      mkdirSync(monthDir, { recursive: true });
      writeFileSync(
        join(monthDir, "03.journal"),
        "2026-03-22 * Rewe | Groceries\n    Expenses:Food  10 EUR\n    Assets:Checking\n",
      );
      const state = inspectWorkspace(ws);
      expect(state.ledgerContent).toContain("Rewe");
      expect(state.ledgerContent).toContain("10 EUR");
    });

    it("should concatenate content from multiple journal files", () => {
      const ws = createAndTrack(
        makeCase({
          setup: {
            ledger: {
              accounts: ["account Assets:Checking"],
              transactions: [["2026-01-01 * ExistingTx", "Assets:Checking  100 EUR", "Equity:Opening"]],
            },
          },
        }),
      );
      const monthDir = join(ws.ledgerDir, "2026", "03");
      mkdirSync(monthDir, { recursive: true });
      writeFileSync(
        join(monthDir, "03.journal"),
        "2026-03-22 * NewTx\n    Expenses:Food  20 EUR\n    Assets:Checking\n",
      );
      const state = inspectWorkspace(ws);
      expect(state.ledgerContent).toContain("ExistingTx");
      expect(state.ledgerContent).toContain("NewTx");
    });
  });

  describe("memory content", () => {
    it("should return empty string when no memory.md exists", () => {
      const ws = createAndTrack(makeCase());
      const state = inspectWorkspace(ws);
      expect(state.memoryContent).toBe("");
    });

    it("should return content from memory.md", () => {
      const ws = createAndTrack(makeCase({ setup: { memory: "- Default currency is EUR\n- Landlord is John" } }));
      const state = inspectWorkspace(ws);
      expect(state.memoryContent).toContain("Default currency is EUR");
      expect(state.memoryContent).toContain("Landlord is John");
    });

    it("should return empty string when memory.md is empty", () => {
      const ws = createAndTrack(makeCase());
      writeFileSync(ws.memoryPath, "");
      const state = inspectWorkspace(ws);
      expect(state.memoryContent).toBe("");
    });
  });
});
