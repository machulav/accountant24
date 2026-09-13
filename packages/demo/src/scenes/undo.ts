import type { FeatureDemo } from "../shared/types";

// Undo: the groceries entry from the first scene rolled back through git, the
// ledger checked afterwards, and both changes kept in the history. An undo
// runs git directly, so the app labels it "Run Command", and the separate
// validation step appears because that path does not validate on its own.
export const undo: FeatureDemo = {
  chatTitle: "Undo last change",
  user: { text: "Undo my last change" },
  working: { steps: ["Run Command", "Validate Ledger", "Commit"], duration: "3s" },
  reply: {
    text: "Reverted. The $42.50 :payee[Trader Joe's] entry is out of your ledger again. Both the entry and the undo stay in the history, so nothing is lost.",
  },
};
