import type { FeatureDemo } from "../shared/types";

// One dropped statement becomes transactions in the ledger.
export const statementImport: FeatureDemo = {
  chatTitle: "August statement import",
  user: { text: "Import this statement", attachments: [{ name: "statement-aug.pdf", meta: "PDF · 245 KB" }] },
  working: { steps: ["Extract Text", "Add Transactions", "Commit"], duration: "9s" },
  reply: {
    text: "Done. I added 23 transactions from your August statement.",
  },
};
