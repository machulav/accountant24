import { beforeEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

vi.mock("../../spawn");

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-modify-"));
const LEDGER = join(BASE, "ledger");

vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  LEDGER_DIR: LEDGER,
  MEMORY_PATH: join(BASE, "memory.md"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

const { modifyTransactionsTool } = await import("../modify-transactions.js");

// ── Fake hledger at the spawnText seam ──────────────────────────────
//
// Models real hledger faithfully: `hledger print <terms> -O json` returns all
// transactions matching the ANDed query terms (payee:/desc:/acct:/date:), with
// accurate tsourcepos; our production code does the from_account posting filter.
// `hledger check` returns whatever exit code the test set.

let seededFiles: string[] = [];
let printOverride: string | null = null;
let checkExit = 0;
let checkStderr = "";

function makeMockProc(exitCode: number, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

function seed(relPath: string, content: string): string {
  const abs = join(LEDGER, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  seededFiles.push(abs);
  return abs;
}

/** Extract the hledger query terms from the spawn argv (between the -f file and -O). */
function queryTerms(cmd: string[]): string[] {
  const fileIdx = cmd.indexOf("-f");
  const outIdx = cmd.indexOf("-O");
  if (fileIdx < 0 || outIdx < 0) return [];
  return cmd.slice(fileIdx + 2, outIdx);
}

function parseHeader(line: string): { date: string; payee: string; description: string } | null {
  const m = line.match(/^(\d{4}-\d{2}-\d{2})(?:=\d{4}-\d{2}-\d{2})?\s+(?:[*!]\s+)?(?:\([^)]*\)\s+)?(.*)$/);
  if (!m) return null;
  let description = m[2];
  const comment = description.indexOf(";");
  if (comment >= 0) description = description.slice(0, comment);
  description = description.trim();
  const pipe = description.indexOf("|");
  const payee = (pipe >= 0 ? description.slice(0, pipe) : description).trim();
  return { date: m[1], payee, description };
}

function termMatches(
  term: string,
  tx: { date: string; payee: string; description: string; accounts: string[] },
): boolean {
  const colon = term.indexOf(":");
  const field = term.slice(0, colon);
  const value = term.slice(colon + 1);
  switch (field) {
    case "payee":
      return new RegExp(value, "i").test(tx.payee);
    case "desc":
      return new RegExp(value, "i").test(tx.description);
    case "acct":
      return tx.accounts.some((a) => new RegExp(value, "i").test(a));
    case "date":
      return tx.date.startsWith(value);
    default:
      return false;
  }
}

function fakeHledgerPrintJson(terms: string[]): string {
  const txns: unknown[] = [];
  for (const file of seededFiles) {
    // Real hledger tolerates CRLF; split on either so line numbers stay accurate.
    const lines = readFileSync(file, "utf-8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const header = parseHeader(lines[i]);
      if (!header) continue;

      const accounts: string[] = [];
      const tpostings: Array<{ paccount: string }> = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === "" || !/^\s/.test(l)) break;
        const body = l.replace(/^\s+/, "");
        if (body.startsWith(";")) continue;
        // Model hledger's `paccount`: it excludes any posting status marker and the
        // brackets of virtual/balanced-virtual postings.
        const afterStatus = body.replace(/^[*!]\s+/, "");
        const sep = afterStatus.match(/ {2,}|\t+/);
        let account = (sep ? afterStatus.slice(0, sep.index) : afterStatus).replace(/\s+$/, "");
        if ((account.startsWith("(") && account.endsWith(")")) || (account.startsWith("[") && account.endsWith("]"))) {
          account = account.slice(1, -1);
        }
        accounts.push(account);
        tpostings.push({ paccount: account });
      }

      const tx = { ...header, accounts };
      if (!terms.every((t) => termMatches(t, tx))) continue;

      const pos = { sourceName: file, sourceLine: i + 1, sourceColumn: 1 };
      txns.push({ tsourcepos: [pos, pos], tpostings });
    }
  }
  return JSON.stringify(txns);
}

beforeEach(() => {
  seededFiles = [];
  printOverride = null;
  checkExit = 0;
  checkStderr = "";
  rmSync(LEDGER, { recursive: true, force: true });
  mkdirSync(LEDGER, { recursive: true });
  writeFileSync(join(LEDGER, "main.journal"), "");

  vi.mocked(spawnText).mockImplementation(async (cmd: string[]) => {
    if (cmd.includes("print")) {
      return makeMockProc(0, printOverride ?? fakeHledgerPrintJson(queryTerms(cmd)));
    }
    if (cmd.includes("check")) {
      return makeMockProc(checkExit, "", checkStderr);
    }
    return makeMockProc(0);
  });
});

const run = (params: any) =>
  modifyTransactionsTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

function read(relPath: string): string {
  return readFileSync(join(LEDGER, relPath), "utf-8");
}

// Fixed-column posting line: account at 4-space indent, amount token starting at `col`.
function posting(account: string, amount: string, col = 50): string {
  const prefix = `    ${account}`;
  const pad = Math.max(2, col - prefix.length);
  return `${prefix}${" ".repeat(pad)}${amount}`;
}

// ── execution mode ──────────────────────────────────────────────────

describe("modify_transactions execution mode", () => {
  test("should run sequentially so ledger writes never interleave", () => {
    // pi runs any batch containing a "sequential" tool one call at a time.
    expect(modifyTransactionsTool.executionMode).toBe("sequential");
  });
});

// ── field: account ──────────────────────────────────────────────────

describe("modify_transactions: field account", () => {
  const acct = (from: string, next: string) => ({
    field: "account" as const,
    from_account: from,
    new_value: next,
  });

  test("rewrites only the target posting; sibling postings are byte-identical", async () => {
    const before = [
      "2026-03-15 * EDEKA | groceries",
      posting("expenses:uncategorized", "45.00 EUR"),
      posting("assets:checking", "-45.00 EUR"),
      "",
    ].join("\n");
    seed("2026/03.journal", before);

    await run({ query: ["payee:EDEKA"], ...acct("expenses:uncategorized", "expenses:food:groceries") });

    const after = read("2026/03.journal").split("\n");
    expect(after[0]).toBe("2026-03-15 * EDEKA | groceries");
    expect(after[1].trim().startsWith("expenses:food:groceries")).toBe(true);
    expect(after[1]).toContain("45.00 EUR");
    expect(after[2]).toBe(posting("assets:checking", "-45.00 EUR"));
  });

  test("preserves the amount's original column after the account swap", async () => {
    const original = posting("expenses:uncategorized", "45.00 EUR");
    seed("2026/03.journal", ["2026-03-15 * EDEKA", original, posting("assets:checking", "-45.00 EUR"), ""].join("\n"));

    await run({ query: ["payee:EDEKA"], ...acct("expenses:uncategorized", "expenses:food:groceries") });

    const movedLine = read("2026/03.journal").split("\n")[1];
    expect(movedLine.indexOf("45.00 EUR")).toBe(original.indexOf("45.00 EUR"));
  });

  test("rewrites an amountless balancing posting to just the target account", async () => {
    seed(
      "2026/03.journal",
      ["2026-03-15 * EDEKA", posting("assets:checking", "-45.00 EUR"), "    expenses:uncategorized", ""].join("\n"),
    );

    await run({ query: ["payee:EDEKA"], ...acct("expenses:uncategorized", "expenses:food:groceries") });

    expect(read("2026/03.journal").split("\n")[2]).toBe("    expenses:food:groceries");
  });

  test("ANDs multiple query terms and moves across multiple files", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * EDEKA",
        posting("expenses:uncategorized", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );
    // Same payee but no uncategorized posting -> excluded by the acct term.
    seed(
      "2026/04.journal",
      [
        "2026-04-02 * EDEKA",
        posting("expenses:food:groceries", "30.00 EUR"),
        posting("assets:checking", "-30.00 EUR"),
        "",
      ].join("\n"),
    );

    const result = await run({
      query: ["payee:EDEKA", "acct:expenses:uncategorized"],
      ...acct("expenses:uncategorized", "expenses:food:groceries"),
    });

    expect(result.details.transactions).toBe(1);
    expect(result.details.postings).toBe(1);
    expect(result.details.diffs).toHaveLength(1);
  });

  test("moves both postings when a transaction has two target postings", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * EDEKA",
        posting("expenses:uncategorized", "30.00 EUR"),
        posting("expenses:uncategorized", "15.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );

    const result = await run({
      query: ["payee:EDEKA"],
      ...acct("expenses:uncategorized", "expenses:food:groceries"),
    });

    expect(result.details.transactions).toBe(1);
    expect(result.details.postings).toBe(2);
  });

  test("leaves a query match without the target posting untouched", async () => {
    const before = [
      "2026-03-15 * EDEKA",
      posting("expenses:food:groceries", "45.00 EUR"),
      posting("assets:checking", "-45.00 EUR"),
      "",
    ].join("\n");
    seed("2026/03.journal", before);

    const result = await run({
      query: ["payee:EDEKA"],
      ...acct("expenses:uncategorized", "expenses:food:delivery"),
    });

    expect(read("2026/03.journal")).toBe(before);
    expect(result.details.transactions).toBe(0);
    expect(result.details.warnings).toHaveLength(0);
  });

  test("rejects field account without from_account", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * EDEKA",
        posting("expenses:uncategorized", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );
    await expect(
      run({ query: ["payee:EDEKA"], field: "account", new_value: "expenses:food:groceries" }),
    ).rejects.toThrow("from_account is required");
  });

  test("rejects an account new_value containing two or more consecutive spaces", async () => {
    await expect(
      run({ query: ["payee:EDEKA"], ...acct("expenses:uncategorized", "expenses:food  groceries") }),
    ).rejects.toThrow("two or more consecutive spaces");
  });
});

// ── field: payee ────────────────────────────────────────────────────

describe("modify_transactions: field payee", () => {
  const payee = (from: string, next: string) => ({ field: "payee" as const, from_payee: from, new_value: next });

  test("renames the payee, preserving date, status, description, and comment", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * EDK | weekly shop  ; ref:1",
        posting("expenses:food:groceries", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );

    const result = await run({ query: ["payee:EDK"], ...payee("EDK", "EDEKA") });

    const lines = read("2026/03.journal").split("\n");
    expect(lines[0]).toBe("2026-03-15 * EDEKA | weekly shop  ; ref:1");
    expect(result.details.transactions).toBe(1);
    expect(result.details.postings).toBe(0);
  });

  test("renames a payee with no description", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * EDK",
        posting("expenses:food:groceries", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );

    await run({ query: ["payee:EDK"], ...payee("EDK", "EDEKA") });

    expect(read("2026/03.journal").split("\n")[0]).toBe("2026-03-15 * EDEKA");
  });

  test("leaves posting lines untouched", async () => {
    const p1 = posting("expenses:food:groceries", "45.00 EUR");
    const p2 = posting("assets:checking", "-45.00 EUR");
    seed("2026/03.journal", ["2026-03-15 * EDK", p1, p2, ""].join("\n"));

    await run({ query: ["payee:EDK"], ...payee("EDK", "EDEKA") });

    const lines = read("2026/03.journal").split("\n");
    expect(lines[1]).toBe(p1);
    expect(lines[2]).toBe(p2);
  });

  test("renames all matching transactions", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * EDK",
        posting("expenses:food:groceries", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
        "2026-03-20 * EDK",
        posting("expenses:food:groceries", "20.00 EUR"),
        posting("assets:checking", "-20.00 EUR"),
        "",
      ].join("\n"),
    );

    const result = await run({ query: ["payee:EDK"], ...payee("EDK", "EDEKA") });

    expect(result.details.transactions).toBe(2);
    const content = read("2026/03.journal");
    expect(content.match(/\* EDEKA/g)).toHaveLength(2);
  });

  test("is a no-op when the payee already equals new_value", async () => {
    const before = [
      "2026-03-15 * EDEKA",
      posting("expenses:food:groceries", "45.00 EUR"),
      posting("assets:checking", "-45.00 EUR"),
      "",
    ].join("\n");
    seed("2026/03.journal", before);

    const result = await run({ query: ["payee:EDEKA"], ...payee("EDEKA", "EDEKA") });

    expect(read("2026/03.journal")).toBe(before);
    expect(result.details.transactions).toBe(0);
    expect(result.details.diffs).toHaveLength(0);
  });

  test("renames only the payee that exactly equals from_payee, sparing fuzzy matches", async () => {
    // A `payee:DB` query matches both via case-insensitive substring, but only the exact
    // "DB" payee should be renamed; "GOLDBACH" must be left untouched.
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * DB",
        posting("expenses:transport", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
        "2026-03-20 * GOLDBACH",
        posting("expenses:food:groceries", "20.00 EUR"),
        posting("assets:checking", "-20.00 EUR"),
        "",
      ].join("\n"),
    );

    const result = await run({ query: ["payee:DB"], ...payee("DB", "Deutsche Bahn") });

    const content = read("2026/03.journal");
    expect(content).toContain("2026-03-15 * Deutsche Bahn");
    expect(content).toContain("2026-03-20 * GOLDBACH"); // fuzzy match spared
    expect(content).not.toContain("* DB\n");
    expect(result.details.transactions).toBe(1);
  });

  test("keeps a space before '|' when the original payee ran up against it", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * EDK| note",
        posting("expenses:food:groceries", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );

    await run({ query: ["payee:EDK"], ...payee("EDK", "EDEKA") });

    // A separator must stay space-delimited or hledger folds it into the payee.
    expect(read("2026/03.journal").split("\n")[0]).toBe("2026-03-15 * EDEKA | note");
  });

  test("rejects field payee without from_payee", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * EDK",
        posting("expenses:food:groceries", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );
    await expect(run({ query: ["payee:EDK"], field: "payee", new_value: "EDEKA" })).rejects.toThrow(
      "from_payee is required",
    );
  });

  test("rejects a payee new_value containing '|' or ';'", async () => {
    await expect(
      run({ query: ["payee:EDK"], field: "payee", from_payee: "EDK", new_value: "EDEKA | injected" }),
    ).rejects.toThrow("must not contain");
  });
});

// ── query handling, dry_run, validation ─────────────────────────────

describe("modify_transactions: query, dry_run, validation", () => {
  const recat = {
    field: "account" as const,
    from_account: "expenses:uncategorized",
    new_value: "expenses:food:groceries",
  };

  test("matches a single query element containing a space (desc:whole foods)", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * Market | whole foods run",
        posting("expenses:uncategorized", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );

    const result = await run({ query: ["desc:whole foods"], ...recat });

    // The mock asserts the term arrives intact as one argv element (see queryTerms).
    expect(result.details.transactions).toBe(1);
    expect(read("2026/03.journal")).toContain("expenses:food:groceries");
  });

  test("passes each query element as a distinct argv token", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * EDEKA",
        posting("expenses:uncategorized", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );

    await run({ query: ["payee:EDEKA", "desc:whole foods run"], ...recat });

    const printCall = vi.mocked(spawnText).mock.calls.find((c) => c[0].includes("print"));
    expect(printCall?.[0]).toContain("payee:EDEKA");
    expect(printCall?.[0]).toContain("desc:whole foods run"); // single element, space intact
  });

  test("rejects a query term starting with '-'", async () => {
    await expect(run({ query: ["--output-file=/tmp/x"], ...recat })).rejects.toThrow("must not start with '-'");
  });

  test("rejects an empty query array", async () => {
    await expect(run({ query: [], ...recat })).rejects.toThrow("non-empty array");
  });

  test("dry_run returns diffs but leaves files byte-for-byte unchanged", async () => {
    const before = [
      "2026-03-15 * EDEKA",
      posting("expenses:uncategorized", "45.00 EUR"),
      posting("assets:checking", "-45.00 EUR"),
      "",
    ].join("\n");
    seed("2026/03.journal", before);

    const result = await run({ query: ["payee:EDEKA"], ...recat, dry_run: true });

    expect(read("2026/03.journal")).toBe(before);
    expect(result.details.dryRun).toBe(true);
    expect(result.details.diffs).toHaveLength(1);
    expect(result.details.diffs[0].diff).toContain("expenses:food:groceries");
  });

  test("dry_run reports an invalid ledger without writing", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * EDEKA",
        posting("expenses:uncategorized", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );
    checkExit = 1;
    checkStderr = "unknown account 'expenses:food:groceries'";

    const result = await run({ query: ["payee:EDEKA"], ...recat, dry_run: true });

    expect(result.details.ledgerIsValid).toBe(false);
    expect(result.details.validationError).toContain("unknown account");
  });

  test("rolls all files back to the snapshot when validation fails", async () => {
    const before = [
      "2026-03-15 * EDEKA",
      posting("expenses:uncategorized", "45.00 EUR"),
      posting("assets:checking", "-45.00 EUR"),
      "",
    ].join("\n");
    seed("2026/03.journal", before);
    checkExit = 1;
    checkStderr = "unknown account 'expenses:food:groceries'";

    await expect(run({ query: ["payee:EDEKA"], ...recat })).rejects.toThrow("unknown account");
    expect(read("2026/03.journal")).toBe(before);
  });

  test("warns when hledger flags a target posting the text lacks", async () => {
    const before = ["2026-03-15 * EDEKA", posting("assets:checking", "-45.00 EUR"), ""].join("\n");
    seed("2026/03.journal", before);
    printOverride = JSON.stringify([
      {
        tsourcepos: [{ sourceName: join(LEDGER, "2026/03.journal"), sourceLine: 1, sourceColumn: 1 }],
        tpostings: [{ paccount: "expenses:uncategorized" }, { paccount: "assets:checking" }],
      },
    ]);

    const result = await run({ query: ["payee:EDEKA"], ...recat });

    expect(result.details.warnings).toHaveLength(1);
    expect(result.details.transactions).toBe(0);
    expect(read("2026/03.journal")).toBe(before);
  });
});

// ── hledger syntax edge cases ───────────────────────────────────────

describe("modify_transactions: hledger syntax edge cases", () => {
  const recat = {
    field: "account" as const,
    from_account: "expenses:uncategorized",
    new_value: "expenses:food:groceries",
  };

  test("preserves a posting status marker (cleared/pending) when recategorizing", async () => {
    const src = "    * expenses:uncategorized               45.00 EUR";
    seed("2026/03.journal", ["2026-03-15 * EDEKA", src, posting("assets:checking", "-45.00 EUR"), ""].join("\n"));

    await run({ query: ["payee:EDEKA"], ...recat });

    const moved = read("2026/03.journal").split("\n")[1];
    expect(moved.trimStart().startsWith("* expenses:food:groceries")).toBe(true);
    expect(moved.indexOf("45.00 EUR")).toBe(src.indexOf("45.00 EUR")); // amount column preserved
  });

  test("recategorizes a virtual (acct) posting, re-wrapping the brackets", async () => {
    const src = posting("(expenses:uncategorized)", "45.00 EUR");
    seed("2026/03.journal", ["2026-03-15 * EDEKA", posting("assets:checking", "-45.00 EUR"), src, ""].join("\n"));

    await run({ query: ["payee:EDEKA"], ...recat });

    const moved = read("2026/03.journal").split("\n")[2];
    expect(moved.trimStart().startsWith("(expenses:food:groceries)")).toBe(true);
    expect(moved.indexOf("45.00 EUR")).toBe(src.indexOf("45.00 EUR"));
  });

  test("recategorizes a balanced-virtual [acct] posting", async () => {
    seed(
      "2026/03.journal",
      ["2026-03-15 * EDEKA", posting("assets:checking", "-45.00 EUR"), "    [expenses:uncategorized]", ""].join("\n"),
    );

    await run({ query: ["payee:EDEKA"], ...recat });

    expect(read("2026/03.journal").split("\n")[2]).toBe("    [expenses:food:groceries]");
  });

  test("preserves an inline comment on a recategorized posting", async () => {
    const src = "    expenses:uncategorized                45.00 EUR  ; imported";
    seed("2026/03.journal", ["2026-03-15 * EDEKA", src, posting("assets:checking", "-45.00 EUR"), ""].join("\n"));

    await run({ query: ["payee:EDEKA"], ...recat });

    const moved = read("2026/03.journal").split("\n")[1];
    expect(moved.trimStart().startsWith("expenses:food:groceries")).toBe(true);
    expect(moved).toContain("45.00 EUR");
    expect(moved.endsWith("; imported")).toBe(true); // trailing posting comment survives
    expect(moved.indexOf("45.00 EUR")).toBe(src.indexOf("45.00 EUR")); // column preserved
  });

  test("preserves a secondary date (date=date2) when renaming the payee", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15=2026-03-18 * EDK | note",
        posting("expenses:food:groceries", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );

    await run({ query: ["payee:EDK"], field: "payee", from_payee: "EDK", new_value: "EDEKA" });

    expect(read("2026/03.journal").split("\n")[0]).toBe("2026-03-15=2026-03-18 * EDEKA | note");
  });

  test("preserves a transaction code (code) when renaming the payee", async () => {
    seed(
      "2026/03.journal",
      [
        "2026-03-15 * (INV42) EDK",
        posting("expenses:food:groceries", "45.00 EUR"),
        posting("assets:checking", "-45.00 EUR"),
        "",
      ].join("\n"),
    );

    await run({ query: ["payee:EDK"], field: "payee", from_payee: "EDK", new_value: "EDEKA" });

    expect(read("2026/03.journal").split("\n")[0]).toBe("2026-03-15 * (INV42) EDEKA");
  });

  test("applies edits and preserves CRLF line endings", async () => {
    const before = [
      "2026-03-15 * EDEKA",
      posting("expenses:uncategorized", "45.00 EUR"),
      posting("assets:checking", "-45.00 EUR"),
      "",
    ].join("\r\n");
    seed("2026/03.journal", before);

    await run({ query: ["payee:EDEKA"], ...recat });

    const raw = read("2026/03.journal");
    expect(raw).toContain("expenses:food:groceries");
    expect(raw).not.toContain("expenses:uncategorized");
    expect(raw).toContain("\r\n"); // CRLF preserved
    expect(raw).not.toContain("\r\r"); // no doubled carriage returns
  });
});
