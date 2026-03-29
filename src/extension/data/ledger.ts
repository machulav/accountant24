import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { ACCOUNTANT24_HOME, LEDGER_DIR } from "../config";
import { HledgerCommandError, HledgerNotFoundError, hledgerCheck, runHledger } from "../hledger";

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
    const journal = join(LEDGER_DIR, "main.journal");
    const stdout = await runHledger([subcommand, "-f", journal]);
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
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
  txText: string;
  relPath: string;
  validationStatus: string;
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

  const txText = formatTransaction(params);

  // Route to monthly file
  const [year, month] = params.date.split("-");
  const relPath = `ledger/${year}/${month}.journal`;
  const absPath = resolveSafePath(`${year}/${month}.journal`, LEDGER_DIR);
  const mainPath = join(LEDGER_DIR, "main.journal");

  // Ensure directory exists
  mkdirSync(dirname(absPath), { recursive: true });

  // Append or create
  const isNew = !existsSync(absPath);
  if (isNew) {
    writeFileSync(absPath, `${txText}\n`);
  } else {
    const existing = readFileSync(absPath, "utf-8");
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(absPath, `${existing}${separator}${txText}\n`);
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
  let validationStatus = "Valid.";
  try {
    await hledgerCheck(mainPath, { cwd: ACCOUNTANT24_HOME, signal });
  } catch (e) {
    if (e instanceof HledgerNotFoundError) {
      validationStatus = "hledger not found, skipped validation.";
    } else if (e instanceof HledgerCommandError) {
      throw new Error(`Validation failed:\n${e.message}\n\nTransaction was written to ${relPath} but has errors.`);
    } else {
      throw e;
    }
  }

  return { txText, relPath, validationStatus };
}

// ── Query ───────────────────────────────────────────────────────────

export async function queryLedger(params: any, signal?: AbortSignal): Promise<string> {
  const file = params.file ?? "ledger/main.journal";
  const resolved = resolveSafePath(file, ACCOUNTANT24_HOME);
  const args = buildQueryArgs(params, resolved);
  return runHledger(args, { signal });
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

  if (params.period) {
    const map: Record<string, string> = {
      daily: "--daily",
      weekly: "--weekly",
      monthly: "--monthly",
      quarterly: "--quarterly",
      yearly: "--yearly",
    };
    if (map[params.period]) args.push(map[params.period]);
  }

  if (params.depth != null) args.push("--depth", String(params.depth));
  if (params.invert) args.push("--invert");
  if (params.output_format) args.push("-O", params.output_format);

  // Prevent account name truncation in register reports
  const REGISTER_WIDTH = 200;
  if (params.report === "reg" || params.report === "aregister") {
    args.push(`--width=${REGISTER_WIDTH}`);
  }

  return args;
}

// ── Validation ──────────────────────────────────────────────────────

export async function validateLedger(signal?: AbortSignal): Promise<string> {
  const resolved = resolveSafePath("main.journal", LEDGER_DIR);

  try {
    await hledgerCheck(resolved, { signal });
  } catch (e) {
    if (e instanceof HledgerNotFoundError) {
      return "hledger not found, skipped journal check.";
    }
    if (e instanceof HledgerCommandError) {
      throw new Error(`Ledger errors:\n${e.message}`);
    }
    throw e;
  }

  return "Ledger is valid.";
}

// ── Internals ───────────────────────────────────────────────────────

function resolveSafePath(userPath: string, baseDir: string): string {
  const resolved = normalize(resolve(baseDir, userPath));
  if (!resolved.startsWith(baseDir)) {
    throw new Error(`Path escapes base directory: ${userPath}`);
  }
  return resolved;
}
