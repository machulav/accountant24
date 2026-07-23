import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateDiffString } from "@earendil-works/pi-coding-agent";
import { ACCOUNTANT24_HOME, LEDGER_DIR } from "../config";
import { HledgerCommandError, hledgerCheck } from "./hledger";
import { resolveSafePath } from "./paths";

// ── Types ───────────────────────────────────────────────────────────

export interface AddTransactionParams {
  date: string;
  payee: string;
  description?: string;
  postings: Array<{
    account: string;
    amount: number;
    currency: string;
  }>;
  tags?: Array<{ name: string; value?: string }>;
}

/** A standalone balance checkpoint: hledger's balance assertion, always its
 *  own journal entry (never attached to a regular transaction). */
export interface AddBalanceAssertionParams {
  date: string;
  account: string;
  balance: { amount: number; currency: string };
}

/** A market price: hledger's P directive, stating what one unit of a
 *  commodity was worth on a date. */
export interface AddPriceParams {
  date: string;
  commodity: string;
  price: { amount: number; currency: string };
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
  validateEach(paramsList, validateInputs, "Transaction");
  const formatted = paramsList.map((params) => routeByMonth(params.date, formatTransaction(params)));
  const currencies = paramsList.flatMap((params) => params.postings.map((p) => p.currency));
  return persistFormatted(formatted, currencies, signal);
}

/** Record standalone balance checkpoints: one journal entry per assertion,
 *  each a single zero-amount posting asserting the account's actual balance.
 *  Routed to the monthly files like any transaction; `hledger check --strict`
 *  then proves every assertion or rejects the write with hledger's own
 *  error. */
export async function addBalanceAssertions(
  paramsList: AddBalanceAssertionParams[],
  signal?: AbortSignal,
): Promise<AddTransactionsResult> {
  validateEach(paramsList, validateAssertionInputs, "Assertion");
  const formatted = paramsList.map((params) => routeByMonth(params.date, formatBalanceAssertion(params)));
  const currencies = paramsList.map((params) => params.balance.currency);
  return persistFormatted(formatted, currencies, signal);
}

/** Record market prices as standalone P directives, routed to the monthly
 *  file of each date. Both sides of every price are declared as commodities,
 *  and `hledger check --strict` validates the write; the Net Worth
 *  report values every holding at its latest recorded price. */
export async function addPrices(paramsList: AddPriceParams[], signal?: AbortSignal): Promise<AddTransactionsResult> {
  validateEach(paramsList, validatePriceInputs, "Price");
  const formatted = paramsList.map((params) => routeByMonth(params.date, formatPrice(params)));
  const currencies = paramsList.flatMap((params) => [params.commodity, params.price.currency]);
  return persistFormatted(formatted, currencies, signal);
}

async function persistFormatted(
  formatted: FormattedEntry[],
  currencies: string[],
  signal?: AbortSignal,
): Promise<AddTransactionsResult> {
  const byFile = groupByFile(formatted);
  const fileContents = writeMonthlyFiles(byFile);
  updateMainJournal(byFile);
  declareMissingCommodities(currencies);
  await validateLedger(formatted, signal);
  const diffs = buildDiffs(byFile, fileContents);
  const transactions = formatted.map((f) => ({ transactionText: f.text, fullFilePath: f.fullFilePath }));
  return { transactions, ledgerIsValid: true, diffs };
}

// ── Pipeline steps ─────────────────────────────────────────────────

/** Validate every item, prefixing errors with the item's position (as
 *  `label`) so batch failures point at the offending entry. */
function validateEach<T>(paramsList: T[], validate: (params: T) => void, label: string): void {
  for (let i = 0; i < paramsList.length; i++) {
    try {
      validate(paramsList[i]);
    } catch (e) {
      if (paramsList.length > 1 && e instanceof Error) {
        throw new Error(`${label} ${i + 1}: ${e.message}`);
      }
      throw e;
    }
  }
}

/** Every entry lives in the monthly journal of its date. */
function routeByMonth(date: string, text: string): FormattedEntry {
  const [year, month] = date.split("-");
  return { text, fileKey: `${year}/${month}`, fullFilePath: resolveSafePath(`${year}/${month}.journal`, LEDGER_DIR) };
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

function declareMissingCommodities(currencies: string[]): void {
  const allCurrencies = new Set<string>(currencies);

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
    diffs.push({ fullFilePath, diff: generateDiffString(oldContent, newContent).diff });
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

function validateAssertionInputs(params: AddBalanceAssertionParams): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    throw new Error(`Invalid date format: ${params.date}. Expected YYYY-MM-DD.`);
  }
  if (!params.account) {
    throw new Error("Balance assertion is missing an account.");
  }
  if (params.balance?.amount == null) {
    throw new Error(`Balance assertion for ${params.account} is missing the balance amount.`);
  }
  if (!params.balance.currency) {
    throw new Error(`Balance assertion for ${params.account} is missing the balance currency.`);
  }
}

function validatePriceInputs(params: AddPriceParams): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    throw new Error(`Invalid date format: ${params.date}. Expected YYYY-MM-DD.`);
  }
  if (!params.commodity) {
    throw new Error("Price is missing a commodity.");
  }
  if (params.price?.amount == null) {
    throw new Error(`Price for ${params.commodity} is missing the amount.`);
  }
  if (!(params.price.amount > 0)) {
    throw new Error(`Price for ${params.commodity} must be positive.`);
  }
  if (!params.price.currency) {
    throw new Error(`Price for ${params.commodity} is missing the currency.`);
  }
}

function formatTransaction(params: AddTransactionParams): string {
  const header = params.description
    ? `${params.date} * ${params.payee} | ${params.description}`
    : `${params.date} * ${params.payee}`;

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

/** Every checkpoint carries the same canonical payee, so assertions are easy
 *  to spot (and query) in the journal. */
const BALANCE_ASSERTION_PAYEE = "Balance Assertion";

function formatBalanceAssertion(params: AddBalanceAssertionParams): string {
  const header = `${params.date} * ${BALANCE_ASSERTION_PAYEE}`;
  // A zero-amount posting moves no money and balances on its own; hledger's
  // `= balance` after the amount is the assertion being checked.
  const amountStr = `0.00 ${params.balance.currency}`;
  const prefix = `    ${params.account}`;
  const pad = Math.max(2, 69 - prefix.length);
  const assertion = ` = ${params.balance.amount.toFixed(2)} ${params.balance.currency}`;
  return `${header}\n${prefix}${" ".repeat(pad)}${amountStr}${assertion}`;
}

/** hledger requires double quotes around a commodity symbol containing
 *  anything besides letters or currency signs (digits, spaces, punctuation)
 *  — e.g. a ticker like "SOL2". */
function quoteCommodity(commodity: string): string {
  return /^[\p{L}\p{Sc}]+$/u.test(commodity) ? commodity : `"${commodity}"`;
}

/** Plain decimal rendering preserving the given precision — market rates
 *  carry meaning in their decimals (0.0205), so no fixed rounding; tiny
 *  rates must never fall into exponential notation. */
function formatPriceAmount(amount: number): string {
  const plain = String(amount);
  if (!plain.toLowerCase().includes("e")) return plain;
  return amount.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPrice(params: AddPriceParams): string {
  const amount = `${formatPriceAmount(params.price.amount)} ${quoteCommodity(params.price.currency)}`;
  return `P ${params.date} ${quoteCommodity(params.commodity)} ${amount}`;
}
