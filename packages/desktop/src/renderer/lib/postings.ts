// Which side of a transaction the register leads with: the balance-sheet
// legs (assets and liabilities — the accounts that exist in the real world,
// same split hledger's own bs report makes) versus the categorization legs
// (expenses, income, equity) that unfold on demand.

import type { LedgerPosting } from "@/rpc/types";

/** Accounts hledger classifies as balance-sheet: an assets/liabilities top
 *  segment, alone or followed by subaccounts. */
const BALANCE_SHEET = /^(?:assets?|liabilit(?:y|ies))(?::|$)/i;

export interface SplitPostings {
  /** The legs the collapsed row leads with: the balance-sheet legs money
   *  left from — or all balance-sheet legs when none flowed out, or every
   *  leg when the transaction touches no balance-sheet account at all. */
  shown: LedgerPosting[];
  /** The remaining legs, revealed by expanding the row. */
  hidden: LedgerPosting[];
}

const isOutflow = (p: LedgerPosting): boolean => (p.amounts[0]?.quantity ?? 0) < 0;

export function splitPostings(postings: LedgerPosting[]): SplitPostings {
  const balanceSheet = postings.filter((p) => BALANCE_SHEET.test(p.account));
  if (balanceSheet.length === 0) return { shown: postings, hidden: [] };
  // A transfer between real accounts leads with the source leg (where the
  // money was sent from), exactly like a spending row leads with the paying
  // account; the receiving leg folds. With a single real leg, or none
  // flowing out (e.g. a salary), the real legs all show.
  const sources = balanceSheet.filter(isOutflow);
  const shown = balanceSheet.length > 1 && sources.length > 0 ? sources : balanceSheet;
  return { shown, hidden: postings.filter((p) => !shown.includes(p)) };
}
