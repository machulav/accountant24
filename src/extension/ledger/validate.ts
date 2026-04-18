import { MAIN_LEDGER_FILE } from "../config";
import { HledgerCommandError, hledgerCheck } from "./hledger";

export interface ValidateLedgerResult {
  ledgerIsValid: boolean;
}

export async function validateLedger(signal?: AbortSignal): Promise<ValidateLedgerResult> {
  const resolved = MAIN_LEDGER_FILE;

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
