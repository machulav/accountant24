import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ACCOUNTANT24_HOME, LEDGER_DIR } from "../config";
import { generateDiff } from "../files/diff";
import { HledgerCommandError, hledgerCheck } from "./hledger";
import { resolveSafePath } from "./paths";

// ── Types ───────────────────────────────────────────────────────────

export interface AddTransactionParams {
  date: string;
  payee: string;
  description: string;
  postings: Array<{
    account: string;
    amount: number;
    currency: string;
  }>;
  tags?: Array<{ name: string; value?: string }>;
}

export interface AddTransactionsResult {
  transactions: Array<{ transactionText: string; fullFilePath: string }>;
  ledgerIsValid: boolean;
  diffs: Array<{ fullFilePath: string; diff: string }>;
}

interface FormattedEntry {
  text: string;
  fileKey: string;
  fullFilePath: string;
}

// ── Public ──────────────────────────────────────────────────────────

export async function addTransactions(
  paramsList: AddTransactionParams[],
  signal?: AbortSignal,
): Promise<AddTransactionsResult> {
  validateAll(paramsList);
  const formatted = formatAll(paramsList);
  const byFile = groupByFile(formatted);
  const fileContents = writeMonthlyFiles(byFile);
  updateMainJournal(byFile);
  declareMissingCommodities(paramsList);
  await validateLedger(formatted, signal);
  const diffs = buildDiffs(byFile, fileContents);
  const transactions = formatted.map((f) => ({ transactionText: f.text, fullFilePath: f.fullFilePath }));
  return { transactions, ledgerIsValid: true, diffs };
}

// ── Pipeline steps ─────────────────────────────────────────────────

function validateAll(paramsList: AddTransactionParams[]): void {
  for (let i = 0; i < paramsList.length; i++) {
    try {
      validateInputs(paramsList[i]);
    } catch (e) {
      if (paramsList.length > 1 && e instanceof Error) {
        throw new Error(`Transaction ${i + 1}: ${e.message}`);
      }
      throw e;
    }
  }
}

function formatAll(paramsList: AddTransactionParams[]): FormattedEntry[] {
  return paramsList.map((params) => {
    const [year, month] = params.date.split("-");
    const fullFilePath = resolveSafePath(`${year}/${month}.journal`, LEDGER_DIR);
    return { text: formatTransaction(params), fileKey: `${year}/${month}`, fullFilePath };
  });
}

function groupByFile(formatted: FormattedEntry[]): Map<string, FormattedEntry[]> {
  const byFile = new Map<string, FormattedEntry[]>();
  for (const entry of formatted) {
    let group = byFile.get(entry.fileKey);
    if (!group) {
      group = [];
      byFile.set(entry.fileKey, group);
    }
    group.push(entry);
  }
  return byFile;
}

interface FileContents {
  oldContents: Map<string, string>;
  newContents: Map<string, string>;
}

/** Writes transactions to monthly journal files. Returns old and new contents for diff generation. */
function writeMonthlyFiles(byFile: Map<string, FormattedEntry[]>): FileContents {
  const oldContents = new Map<string, string>();
  const newContents = new Map<string, string>();

  for (const [fileKey, entries] of byFile) {
    const fullFilePath = entries[0].fullFilePath;
    mkdirSync(dirname(fullFilePath), { recursive: true });

    const isNew = !existsSync(fullFilePath);
    const oldContent = isNew ? "" : readFileSync(fullFilePath, "utf-8");
    oldContents.set(fileKey, oldContent);

    const joined = entries.map((e) => e.text).join("\n\n");
    let newContent: string;
    if (isNew) {
      newContent = `${joined}\n`;
    } else {
      const separator = oldContent.endsWith("\n") ? "\n" : "\n\n";
      newContent = `${oldContent}${separator}${joined}\n`;
    }
    writeFileSync(fullFilePath, newContent);
    newContents.set(fileKey, newContent);
  }

  return { oldContents, newContents };
}

function updateMainJournal(byFile: Map<string, FormattedEntry[]>): void {
  const mainPath = resolveSafePath("main.journal", LEDGER_DIR);
  if (!existsSync(mainPath)) return;

  let mainContent = readFileSync(mainPath, "utf-8");
  let mainChanged = false;

  for (const [fileKey] of byFile) {
    const includeDirective = `include ${fileKey}.journal`;
    if (!mainContent.includes(includeDirective)) {
      const sep = mainContent.endsWith("\n") ? "" : "\n";
      mainContent = `${mainContent}${sep}${includeDirective}\n`;
      mainChanged = true;
    }
  }

  // Ensure main.journal includes commodities.journal (for pre-existing workspaces)
  if (!mainContent.includes("include commodities.journal")) {
    mainContent = `include commodities.journal\n${mainContent}`;
    mainChanged = true;
  }

  if (mainChanged) {
    writeFileSync(mainPath, mainContent);
  }
}

function declareMissingCommodities(paramsList: AddTransactionParams[]): void {
  const allCurrencies = new Set<string>();
  for (const params of paramsList) {
    for (const p of params.postings) {
      allCurrencies.add(p.currency);
    }
  }

  const commoditiesPath = resolveSafePath("commodities.journal", LEDGER_DIR);
  const commoditiesContent = existsSync(commoditiesPath) ? readFileSync(commoditiesPath, "utf-8") : "";
  const missingCommodities: string[] = [];
  for (const cur of allCurrencies) {
    const pattern = new RegExp(`^commodity\\s+.*${cur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
    if (!pattern.test(commoditiesContent)) {
      missingCommodities.push(cur);
    }
  }

  if (missingCommodities.length > 0) {
    const declarations = missingCommodities.map((c) => `commodity ${c}`).join("\n");
    const sep = commoditiesContent.endsWith("\n") ? "" : "\n";
    writeFileSync(commoditiesPath, `${commoditiesContent}${sep}${declarations}\n`);
  }
}

async function validateLedger(formatted: FormattedEntry[], signal?: AbortSignal): Promise<void> {
  const mainPath = resolveSafePath("main.journal", LEDGER_DIR);
  try {
    await hledgerCheck(mainPath, { cwd: ACCOUNTANT24_HOME, signal });
  } catch (e) {
    if (e instanceof HledgerCommandError) {
      const filePaths = [...new Set(formatted.map((f) => f.fullFilePath))].join(", ");
      throw new Error(`Transactions saved to ${filePaths} but the ledger has errors:\n\n${e.stderr}`);
    }
    throw e;
  }
}

function buildDiffs(
  byFile: Map<string, FormattedEntry[]>,
  { oldContents, newContents }: FileContents,
): AddTransactionsResult["diffs"] {
  const diffs: AddTransactionsResult["diffs"] = [];
  for (const [fileKey, entries] of byFile) {
    const fullFilePath = entries[0].fullFilePath;
    const oldContent = oldContents.get(fileKey) ?? "";
    const newContent = newContents.get(fileKey) ?? "";
    diffs.push({ fullFilePath, diff: generateDiff(oldContent, newContent) });
  }
  return diffs;
}

// ── Validation & formatting ────────────────────────────────────────

function validateInputs(params: Pick<AddTransactionParams, "date" | "postings">): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    throw new Error(`Invalid date format: ${params.date}. Expected YYYY-MM-DD.`);
  }
  if (params.postings.length < 2) {
    throw new Error("At least 2 postings are required.");
  }
  for (const p of params.postings) {
    if (p.amount == null) {
      throw new Error(`Posting for ${p.account} is missing amount.`);
    }
    if (!p.currency) {
      throw new Error(`Posting for ${p.account} is missing currency.`);
    }
  }
}

function formatTransaction(params: AddTransactionParams): string {
  const header = `${params.date} * ${params.payee} | ${params.description}`;

  const lines = [header];

  if (params.tags?.length) {
    const sortedTags = [...params.tags].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    for (const tag of sortedTags) {
      lines.push(tag.value != null ? `    ; ${tag.name}: ${tag.value}` : `    ; ${tag.name}:`);
    }
  }

  const sortedPostings = [...params.postings].sort((a, b) => {
    const groupA = a.amount < 0 ? 0 : 1;
    const groupB = b.amount < 0 ? 0 : 1;
    return groupA - groupB;
  });

  for (const p of sortedPostings) {
    const sign = p.amount < 0 ? "-" : "";
    const amountStr = `${sign}${Math.abs(p.amount).toFixed(2)} ${p.currency}`;
    const prefix = `    ${p.account}`;
    // Align first digit at column 70 (1-indexed); sign hangs left at 69
    const targetCol = 69 - sign.length;
    const pad = Math.max(2, targetCol - prefix.length);
    lines.push(`${prefix}${" ".repeat(pad)}${amountStr}`);
  }

  return lines.join("\n");
}
