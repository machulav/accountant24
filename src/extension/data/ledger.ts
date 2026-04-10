import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, normalize, resolve } from "node:path";
import { ACCOUNTANT24_HOME, LEDGER_DIR } from "../config";
import { HledgerCommandError, hledgerCheck, runHledger } from "../hledger";
import { generateDiff } from "./diff";
import { ledgerFormat } from "./format";

const PERIOD_FLAGS: Record<string, string> = {
  daily: "--daily",
  weekly: "--weekly",
  monthly: "--monthly",
  quarterly: "--quarterly",
  yearly: "--yearly",
};

// TUI box border (2) + padding (2) + content indent (2)
const TUI_CHROME_WIDTH = 6;

// ── Read operations ─────────────────────────────────────────────────

export async function listAccounts(): Promise<string[]> {
  return loadHledgerList("accounts");
}

export async function listPayees(): Promise<string[]> {
  return loadHledgerList("payees");
}

export async function listTags(): Promise<string[]> {
  return loadHledgerList("tags");
}

async function loadHledgerList(subcommand: string): Promise<string[]> {
  try {
    const journal = resolveSafePath("main.journal", LEDGER_DIR);
    const stdout = await runHledger([subcommand, "-f", journal]);
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch {
    return [];
  }
}

// ── Add transaction ─────────────────────────────────────────────────

export interface AddTransactionParams {
  date: string;
  payee: string;
  narration: string;
  postings: Array<{
    account: string;
    amount?: number;
    currency?: string;
  }>;
  tags?: string[];
  metadata?: Record<string, string>;
}

export interface AddTransactionResult {
  transactionText: string;
  fullFilePath: string;
  ledgerIsValid: boolean;
  diff: string;
}

function validateInputs(params: { date: string; postings: any[] }): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    throw new Error(`Invalid date format: ${params.date}. Expected YYYY-MM-DD.`);
  }
  if (params.postings.length < 2) {
    throw new Error("At least 2 postings are required.");
  }
  const blanks = params.postings.filter((p: any) => p.amount == null);
  if (blanks.length > 1) {
    throw new Error("At most one posting may omit the amount.");
  }
  for (const p of params.postings) {
    if (p.amount != null && !p.currency) {
      throw new Error(`Posting for ${p.account} has amount but no currency.`);
    }
  }
}

function formatTransaction(params: {
  date: string;
  payee: string;
  narration: string;
  postings: any[];
  tags?: string[];
  metadata?: Record<string, string>;
}): string {
  const header = `${params.date} * ${params.payee} | ${params.narration}`;

  const lines = [header];

  if (params.tags?.length) {
    lines.push(`    ; ${params.tags.map((t) => `${t}:`).join(", ")}`);
  }

  if (params.metadata) {
    for (const [key, value] of Object.entries(params.metadata)) {
      lines.push(`    ; ${key}: ${value}`);
    }
  }

  for (const p of params.postings) {
    if (p.amount != null) {
      lines.push(`    ${p.account}    ${p.amount.toFixed(2)} ${p.currency}`);
    } else {
      lines.push(`    ${p.account}`);
    }
  }

  return lines.join("\n");
}

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

  // Format every file in the ledger's include graph before validation so
  // any formatter regression is caught immediately by hledgerCheck.
  await ledgerFormat(mainPath, { cwd: ACCOUNTANT24_HOME, signal });

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

// ── Query ───────────────────────────────────────────────────────────

export interface QueryLedgerResult {
  command: string;
  output: string;
}

export async function queryLedger(params: any, signal?: AbortSignal): Promise<QueryLedgerResult> {
  const file = params.file ?? "ledger/main.journal";
  const resolved = resolveSafePath(file, ACCOUNTANT24_HOME);
  const args = buildQueryArgs(params, resolved);
  const raw = await runHledger(args, { signal });
  const command = ["hledger", ...args].join(" ");
  return { command, output: raw || "(no results)" };
}

function buildQueryArgs(params: any, resolved: string): string[] {
  const args = [params.report, "-f", resolved];

  if (params.account_pattern) args.push(params.account_pattern);
  if (params.description_pattern) args.push(`desc:${params.description_pattern}`);
  if (params.payee_pattern) args.push(`payee:${params.payee_pattern}`);
  if (params.amount_filter) args.push(`amt:${params.amount_filter}`);
  if (params.tag) args.push(`tag:${params.tag}`);
  if (params.status === "cleared") args.push("status:*");
  else if (params.status === "pending") args.push("status:!");
  else if (params.status === "unmarked") args.push("status:");

  if (params.begin_date) args.push("-b", params.begin_date);
  if (params.end_date) args.push("-e", params.end_date);

  if (params.period && PERIOD_FLAGS[params.period]) {
    args.push(PERIOD_FLAGS[params.period]);
  }

  if (params.depth != null) args.push("--depth", String(params.depth));
  if (params.invert) args.push("--invert");
  if (params.output_format) args.push("-O", params.output_format);

  if (params.report === "reg" || params.report === "aregister") {
    const width = (process.stdout.columns || 80) - TUI_CHROME_WIDTH;
    args.push(`--width=${width}`);
  }

  return args;
}

// ── Validation ──────────────────────────────────────────────────────

export interface ValidateLedgerResult {
  ledgerIsValid: boolean;
}

export async function validateLedger(signal?: AbortSignal): Promise<ValidateLedgerResult> {
  const mainPath = resolveSafePath("main.journal", LEDGER_DIR);

  // Format every file in the ledger's include graph before running
  // hledger check so any formatter regression is caught immediately.
  await ledgerFormat(mainPath, { signal });

  try {
    await hledgerCheck(mainPath, { signal });
  } catch (e) {
    if (e instanceof HledgerCommandError) {
      throw new Error(e.stderr);
    }
    throw e;
  }

  return { ledgerIsValid: true };
}

// ── Internals ───────────────────────────────────────────────────────

function resolveSafePath(userPath: string, baseDir: string): string {
  const resolved = normalize(resolve(baseDir, userPath));
  if (!resolved.startsWith(baseDir)) {
    throw new Error(`Path escapes base directory: ${userPath}`);
  }
  return resolved;
}
