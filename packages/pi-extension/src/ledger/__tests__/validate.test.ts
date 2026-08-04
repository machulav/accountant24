import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-validate-"));
const LEDGER = join(BASE, "ledger");

vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: join(BASE, "ledger"),
  MEMORY_PATH: join(BASE, "memory.md"),
  setBaseDir: () => {},
}));

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

const { validateLedger } = await import("../validate.js");

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(LEDGER, { recursive: true, force: true });
});

describe("validateLedger()", () => {
  test("should return ledgerIsValid with an empty tidy summary when there are no monthly files", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0));
    const result = await validateLedger();
    expect(result).toEqual({ ledgerIsValid: true, tidy: { files: 0, changed: 0, diffs: [], skipped: [] } });
  });

  test("should throw Error with stderr when hledger check fails", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(1, "", "account Assets:Missing not declared"));
    await expect(validateLedger()).rejects.toThrow("account Assets:Missing not declared");
  });

  test("should throw plain Error (not HledgerCommandError) on check failure", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(1, "", "some validation error"));
    try {
      await validateLedger();
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).not.toBe("HledgerCommandError");
    }
  });

  test("should throw HledgerNotFoundError when hledger is missing", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(127));
    await expect(validateLedger()).rejects.toThrow("hledger not found");
  });

  test("should re-throw unexpected errors", async () => {
    vi.mocked(spawnText).mockRejectedValue(new TypeError("unexpected spawn failure"));
    await expect(validateLedger()).rejects.toThrow("unexpected spawn failure");
  });

  test("should call hledger with check --strict", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0));
    await validateLedger();
    const args = vi.mocked(spawnText).mock.calls[0][0];
    expect(args).toContain("check");
    expect(args).toContain("--strict");
  });

  test("should pass the main.journal path to hledger", async () => {
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(0));
    await validateLedger();
    const args = vi.mocked(spawnText).mock.calls[0][0];
    expect(args).toContain("-f");
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toContain("main.journal");
  });
});

// ── Tidying before validation ───────────────────────────────────────

// Sloppy 2-space-indent inputs and their canonical renderings (alignment column 69).
const RENT = "2026-03-20 * Rent\n  Expenses:Rent  900.00 USD\n  Assets:Bank\n";
const SHOP = "2026-03-05 * Shop\n  Expenses:Food  45.00 USD\n  Assets:Cash\n";
const CANON_RENT = `2026-03-20 * Rent\n    Expenses:Rent${" ".repeat(52)}900.00 USD\n    Assets:Bank\n`;
const CANON_SHOP = `2026-03-05 * Shop\n    Expenses:Food${" ".repeat(52)}45.00 USD\n    Assets:Cash\n`;

const MARCH = join(LEDGER, "2026", "03.journal");

describe("validateLedger() tidying", () => {
  let checkExit = 0;
  let checkStderr = "";
  let printExit = 0;
  let printStderr = "";
  let printOutputs: string[] | null = null; // null → every print returns "[]"

  beforeEach(() => {
    mkdirSync(join(LEDGER, "2026"), { recursive: true });
    writeFileSync(join(LEDGER, "main.journal"), "include 2026/03.journal\n");
    checkExit = 0;
    checkStderr = "";
    printExit = 0;
    printStderr = "";
    printOutputs = null;
    vi.mocked(spawnText).mockImplementation(async (cmd: string[]) => {
      if (cmd[1] === "print") {
        return makeMockProc(printExit, printOutputs ? (printOutputs.shift() ?? "[]") : "[]", printStderr);
      }
      return makeMockProc(checkExit, "", checkStderr);
    });
  });

  test("should sort and format monthly files when the ledger is valid", async () => {
    writeFileSync(MARCH, `${RENT}\n${SHOP}`);
    const result = await validateLedger();
    expect(readFileSync(MARCH, "utf-8")).toBe(`${CANON_SHOP}\n${CANON_RENT}`);
    expect(result.ledgerIsValid).toBe(true);
    expect(result.tidy).toMatchObject({ files: 1, changed: 1, skipped: [] });
    expect(result.tidy.diffs[0].fullFilePath).toBe(MARCH);
    expect(result.tidy.diffs[0].diff).toContain("Shop");
  });

  test("should run only hledger check when everything is already tidy", async () => {
    writeFileSync(MARCH, `${CANON_SHOP}\n${CANON_RENT}`);
    const result = await validateLedger();
    expect(result.tidy).toEqual({ files: 1, changed: 0, diffs: [], skipped: [] });
    expect(vi.mocked(spawnText)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnText).mock.calls[0][0]).toContain("check");
  });

  test("should not touch ledger files other than the monthly journals", async () => {
    writeFileSync(MARCH, `${RENT}\n${SHOP}`);
    const accounts = "account Assets:Bank\naccount   Assets:Cash\n";
    writeFileSync(join(LEDGER, "accounts.journal"), accounts);
    const result = await validateLedger();
    expect(result.tidy.files).toBe(1);
    expect(readFileSync(join(LEDGER, "accounts.journal"), "utf-8")).toBe(accounts);
  });

  test("should not tidy at all when the check fails, so errors point at the files as written", async () => {
    writeFileSync(MARCH, `${RENT}\n${SHOP}`);
    checkExit = 1;
    checkStderr = "hledger: Error: unbalanced transaction";
    await expect(validateLedger()).rejects.toThrow("unbalanced transaction");
    expect(readFileSync(MARCH, "utf-8")).toBe(`${RENT}\n${SHOP}`);
    // The check is the only hledger run — no snapshot, no write, no restore.
    expect(vi.mocked(spawnText)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnText).mock.calls[0][0]).toContain("check");
  });

  test("should restore tidied files and throw when tidying would change the ledger's meaning", async () => {
    writeFileSync(MARCH, `${RENT}\n${SHOP}`);
    printOutputs = ['[{"tdescription":"Rent"}]', '[{"tdescription":"Rent CHANGED"}]'];
    await expect(validateLedger()).rejects.toThrow("changed the ledger's meaning");
    expect(readFileSync(MARCH, "utf-8")).toBe(`${RENT}\n${SHOP}`);
  });

  test("should ignore position-only differences in the semantic comparison", async () => {
    writeFileSync(MARCH, `${RENT}\n${SHOP}`);
    printOutputs = [
      '[{"tdescription":"Rent","tindex":1,"tsourcepos":[{"sourceLine":1}],"ptransaction_":"1","baposition":{"sourceLine":2}}]',
      '[{"tdescription":"Rent","tindex":9,"tsourcepos":[{"sourceLine":7}],"ptransaction_":"9","baposition":{"sourceLine":8}}]',
    ];
    const result = await validateLedger();
    expect(result.tidy.changed).toBe(1);
  });

  test("should report the check error for already-tidy files without extra hledger runs", async () => {
    writeFileSync(MARCH, `${CANON_SHOP}`);
    checkExit = 1;
    checkStderr = "hledger: Error: account not declared";
    await expect(validateLedger()).rejects.toThrow("account not declared");
    expect(readFileSync(MARCH, "utf-8")).toBe(CANON_SHOP);
  });

  test("should propagate hledger-not-found without touching files", async () => {
    writeFileSync(MARCH, `${RENT}\n${SHOP}`);
    vi.mocked(spawnText).mockResolvedValue(makeMockProc(127));
    await expect(validateLedger()).rejects.toThrow("hledger not found");
    expect(readFileSync(MARCH, "utf-8")).toBe(`${RENT}\n${SHOP}`);
  });

  test("should restore files and rethrow when the semantic snapshot is not valid JSON", async () => {
    writeFileSync(MARCH, `${RENT}\n${SHOP}`);
    let printCalls = 0;
    vi.mocked(spawnText).mockImplementation(async (cmd: string[]) => {
      if (cmd[1] === "print") {
        printCalls += 1;
        return makeMockProc(0, printCalls === 1 ? "[]" : "not json");
      }
      return makeMockProc(0);
    });
    await expect(validateLedger()).rejects.toThrow(SyntaxError);
    expect(readFileSync(MARCH, "utf-8")).toBe(`${RENT}\n${SHOP}`);
  });

  test("should restore files when the formatted result does not parse back", async () => {
    writeFileSync(MARCH, `${RENT}\n${SHOP}`);
    let printCalls = 0;
    vi.mocked(spawnText).mockImplementation(async (cmd: string[]) => {
      if (cmd[1] === "print") {
        printCalls += 1;
        return printCalls === 1 ? makeMockProc(0, "[]") : makeMockProc(1, "", "hledger: Error: parse failure");
      }
      return makeMockProc(0);
    });
    await expect(validateLedger()).rejects.toThrow("the formatted files did not parse");
    expect(readFileSync(MARCH, "utf-8")).toBe(`${RENT}\n${SHOP}`);
  });

  test("should report entries outside the canonical subset and keep them verbatim", async () => {
    const weird = "2026-03-10 * Weird\n    Assets:X    1 BTC @ 55000 EUR\n";
    writeFileSync(MARCH, `${RENT}\n${weird}\n${SHOP}`);
    const result = await validateLedger();
    expect(result.tidy.skipped).toEqual([
      { fullFilePath: MARCH, startLine: 5, reason: "cost notation (@) is not supported" },
    ]);
    expect(readFileSync(MARCH, "utf-8")).toContain(weird);
  });

  test("should leave every file untouched when the check fails, including files that needed tidying", async () => {
    writeFileSync(MARCH, `${RENT}\n${SHOP}`);
    mkdirSync(join(LEDGER, "2025"), { recursive: true });
    const clean = CANON_SHOP.replace(/2026-03/g, "2025-12");
    writeFileSync(join(LEDGER, "2025", "12.journal"), clean);
    checkExit = 1;
    checkStderr = "hledger: Error: nope";
    await expect(validateLedger()).rejects.toThrow("nope");
    expect(readFileSync(MARCH, "utf-8")).toBe(`${RENT}\n${SHOP}`);
    expect(readFileSync(join(LEDGER, "2025", "12.journal"), "utf-8")).toBe(clean);
  });

  test("should still report skipped entries when nothing needed rewriting", async () => {
    const weird = "2026-03-10 * Weird\n    Assets:X    1 BTC @ 55000 EUR\n";
    writeFileSync(MARCH, `${CANON_RENT}\n${weird}\n${CANON_SHOP}`);
    const result = await validateLedger();
    expect(result.tidy.changed).toBe(0);
    expect(result.tidy.skipped).toHaveLength(1);
    expect(vi.mocked(spawnText)).toHaveBeenCalledTimes(1);
  });
});
