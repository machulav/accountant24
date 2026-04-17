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

export interface AddTransactionResult {
  transactionText: string;
  fullFilePath: string;
  ledgerIsValid: boolean;
  diff: string;
}

// ── Public ──────────────────────────────────────────────────────────

export async function addTransaction(
  params: AddTransactionParams,
  signal?: AbortSignal,
): Promise<AddTransactionResult> {
  validateInputs(params);

  const transactionText = formatTransaction(params);

  // Route to monthly file
  const [year, month] = params.date.split("-");
  const fullFilePath = resolveSafePath(`${year}/${month}.journal`, LEDGER_DIR);
  const mainPath = resolveSafePath("main.journal", LEDGER_DIR);

  // Ensure directory exists
  mkdirSync(dirname(fullFilePath), { recursive: true });

  // Append or create
  const isNew = !existsSync(fullFilePath);
  const oldContent = isNew ? "" : readFileSync(fullFilePath, "utf-8");
  if (isNew) {
    writeFileSync(fullFilePath, `${transactionText}\n`);
  } else {
    const separator = oldContent.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(fullFilePath, `${oldContent}${separator}${transactionText}\n`);
  }

  // Update main.journal: includes and commodity declarations
  if (existsSync(mainPath)) {
    let mainContent = readFileSync(mainPath, "utf-8");

    if (isNew) {
      const includeDirective = `include ${year}/${month}.journal`;
      if (!mainContent.includes(includeDirective)) {
        const sep = mainContent.endsWith("\n") ? "" : "\n";
        mainContent = `${mainContent}${sep}${includeDirective}\n`;
        writeFileSync(mainPath, mainContent);
      }
    }

    const currencies = new Set(params.postings.filter((p: any) => p.currency).map((p: any) => p.currency));
    const missingCommodities: string[] = [];
    for (const cur of currencies) {
      const pattern = new RegExp(`^commodity\\s+.*${cur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
      if (!pattern.test(mainContent)) {
        missingCommodities.push(cur);
      }
    }
    if (missingCommodities.length > 0) {
      const declarations = missingCommodities.map((c) => `commodity ${c}`).join("\n");
      writeFileSync(mainPath, `${declarations}\n\n${mainContent}`);
    }
  }

  // Validate
  try {
    await hledgerCheck(mainPath, { cwd: ACCOUNTANT24_HOME, signal });
  } catch (e) {
    if (e instanceof HledgerCommandError) {
      throw new Error(`Transaction saved to ${fullFilePath} but the ledger has errors:\n\n${e.stderr}`);
    }
    throw e;
  }

  const newContent = readFileSync(fullFilePath, "utf-8");
  const diff = generateDiff(oldContent, newContent);

  return { transactionText, fullFilePath, ledgerIsValid: true, diff };
}

// ── Internals ───────────────────────────────────────────────────────

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
