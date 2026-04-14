import { LEDGER_DIR } from "../config";
import { HledgerCommandError, hledgerCheck } from "./hledger";
import { resolveSafePath } from "./paths";

export interface ValidateLedgerResult {
  ledgerIsValid: boolean;
}

export async function validateLedger(signal?: AbortSignal): Promise<ValidateLedgerResult> {
  const resolved = resolveSafePath("main.journal", LEDGER_DIR);

  try {
    await hledgerCheck(resolved, { signal });
  } catch (e) {
    if (e instanceof HledgerCommandError) {
      throw new Error(e.stderr);
    }
    throw e;
  }

  return { ledgerIsValid: true };
}
