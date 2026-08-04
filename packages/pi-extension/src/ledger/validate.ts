import { LEDGER_DIR } from "../config";
import { HledgerCommandError, hledgerCheck } from "./hledger";
import { resolveSafePath } from "./paths";
import { applyTidy, planTidy, printSemantics, restoreTidy, type TidySummary } from "./tidy";

export interface ValidateLedgerResult {
  ledgerIsValid: boolean;
  tidy: TidySummary;
}

/**
 * Validate the ledger, then tidy the journal files.
 *
 * The check runs on the files exactly as they are on disk, so a validation
 * error always points at lines the user can actually see. Only when the ledger
 * proves valid are the monthly files rewritten (entries sorted by date,
 * formatting normalized) — and that rewrite must be layout-only: hledger's own
 * reading of the ledger is snapshotted before and after, and any difference
 * (or any failure in between) restores every byte and throws.
 */
export async function validateLedger(signal?: AbortSignal): Promise<ValidateLedgerResult> {
  const mainPath = resolveSafePath("main.journal", LEDGER_DIR);

  try {
    await hledgerCheck(mainPath, { signal });
  } catch (e) {
    if (e instanceof HledgerCommandError) {
      throw new Error(e.stderr);
    }
    throw e;
  }

  const plan = planTidy();
  const tidy: TidySummary = { files: plan.files, changed: plan.changed, diffs: plan.diffs, skipped: plan.skipped };
  if (plan.changed === 0) {
    return { ledgerIsValid: true, tidy };
  }

  const before = await printSemantics(mainPath, signal);
  applyTidy(plan);

  let after: string;
  try {
    after = await printSemantics(mainPath, signal);
  } catch (e) {
    restoreTidy(plan);
    if (e instanceof HledgerCommandError) {
      throw new Error(`Tidying reverted — the formatted files did not parse:\n\n${e.stderr}`);
    }
    throw e;
  }
  if (after !== before) {
    restoreTidy(plan);
    throw new Error("Tidying would have changed the ledger's meaning, so formatting was left untouched.");
  }

  return { ledgerIsValid: true, tidy };
}
