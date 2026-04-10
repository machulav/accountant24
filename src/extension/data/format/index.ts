import { hledgerFiles } from "../../hledger";
import { formatJournalFile } from "./pipeline";

// Silent no-op on a malformed journal: a subsequent `hledgerCheck` call
// is expected to surface the real error with line numbers.
export async function ledgerFormat(mainPath: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<void> {
  let files: string[];
  try {
    files = await hledgerFiles(mainPath, opts);
  } catch {
    return;
  }
  for (const file of files) {
    formatJournalFile(file);
  }
}
