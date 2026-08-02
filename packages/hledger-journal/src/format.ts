import type { FormatConfig, PriceDirective, Tag, Transaction } from "./types";

export const DEFAULT_FORMAT: FormatConfig = { indent: "    ", alignColumn: 69 };

/** Every checkpoint carries the same canonical payee, so assertions are easy
 *  to spot (and query) in the journal. */
export const BALANCE_ASSERTION_PAYEE = "Balance Assertion";

export interface TransactionInput {
  date: string;
  payee: string;
  description?: string;
  postings: Array<{ account: string; amount: number; currency: string }>;
  tags?: Tag[];
}

export interface BalanceAssertionInput {
  date: string;
  account: string;
  balance: { amount: number; currency: string };
  payee?: string;
}

export interface PriceInput {
  date: string;
  commodity: string;
  price: { amount: number; currency: string };
}

/** hledger requires double quotes around a commodity symbol containing
 *  anything besides letters or currency signs (digits, spaces, punctuation)
 *  — e.g. a ticker like "SOL2". */
export function quoteCommodity(commodity: string): string {
  return /^[\p{L}\p{Sc}]+$/u.test(commodity) ? commodity : `"${commodity}"`;
}

/** Plain decimal rendering preserving the given precision — market rates
 *  carry meaning in their decimals (0.0205), so no fixed rounding; tiny
 *  rates must never fall into exponential notation. */
export function formatPriceAmount(amount: number): string {
  const plain = String(amount);
  if (!plain.toLowerCase().includes("e")) return plain;
  return amount.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatTransaction(params: TransactionInput, config: FormatConfig = DEFAULT_FORMAT): string {
  const header = params.description
    ? `${params.date} * ${params.payee} | ${params.description}`
    : `${params.date} * ${params.payee}`;

  const lines = [header];

  if (params.tags?.length) {
    const sortedTags = [...params.tags].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    for (const tag of sortedTags) {
      lines.push(tag.value != null ? `${config.indent}; ${tag.name}: ${tag.value}` : `${config.indent}; ${tag.name}:`);
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
    lines.push(alignAmount(`${config.indent}${p.account}`, amountStr, sign.length, config));
  }

  return lines.join("\n");
}

export function formatBalanceAssertion(params: BalanceAssertionInput, config: FormatConfig = DEFAULT_FORMAT): string {
  const header = `${params.date} * ${params.payee ?? BALANCE_ASSERTION_PAYEE}`;
  // A zero-amount posting moves no money and balances on its own; hledger's
  // `= balance` after the amount is the assertion being checked.
  const amountStr = `0.00 ${params.balance.currency}`;
  const assertion = ` = ${params.balance.amount.toFixed(2)} ${params.balance.currency}`;
  return `${header}\n${alignAmount(`${config.indent}${params.account}`, amountStr, 0, config)}${assertion}`;
}

export function formatPrice(params: PriceInput): string {
  const amount = `${formatPriceAmount(params.price.amount)} ${quoteCommodity(params.price.currency)}`;
  return `P ${params.date} ${quoteCommodity(params.commodity)} ${amount}`;
}

// ── Canonical re-rendering of parsed entries (used by tidy) ─────────

/** Render a parsed transaction canonically. Layout only: descriptions, comments,
 *  amount texts, and the order of tags/postings are preserved verbatim, so the
 *  entry's meaning to hledger cannot change — only indentation and alignment do. */
export function renderTransaction(tx: Transaction, config: FormatConfig = DEFAULT_FORMAT): string {
  let header = tx.date;
  if (tx.status) header += ` ${tx.status}`;
  if (tx.code != null) header += ` (${tx.code})`;
  if (tx.description) header += ` ${tx.description}`;
  if (tx.headerComment) header += `  ${tx.headerComment}`;

  const lines = [header];
  for (const comment of tx.commentLines) {
    lines.push(`${config.indent}${comment}`);
  }

  for (const p of tx.postings) {
    const account = p.virtual ? `(${p.account})` : p.account;
    let line = `${config.indent}${account}`;
    if (p.amountText != null && p.currency != null) {
      const signLength = p.amountText.startsWith("-") ? 1 : 0;
      line = alignAmount(line, `${p.amountText} ${quoteCommodity(p.currency)}`, signLength, config);
      if (p.assertion) line += ` = ${p.assertion.amountText} ${quoteCommodity(p.assertion.currency)}`;
    }
    if (p.comment) line += `  ${p.comment}`;
    lines.push(line);
  }

  return lines.join("\n");
}

/** Render a parsed P directive canonically, preserving the written amount. */
export function renderPrice(price: PriceDirective): string {
  return `P ${price.date} ${quoteCommodity(price.commodity)} ${price.amountText} ${quoteCommodity(price.currency)}`;
}

/** Pad so the amount's first digit lands at `alignColumn` (its sign hangs one
 *  column left), with a minimum 2-space gap for very long account names. */
function alignAmount(prefix: string, amountStr: string, signLength: number, config: FormatConfig): string {
  const pad = Math.max(2, config.alignColumn - signLength - prefix.length);
  return `${prefix}${" ".repeat(pad)}${amountStr}`;
}
