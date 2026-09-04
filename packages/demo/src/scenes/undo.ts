import type { FeatureDemo } from "../shared/types";

// Undo: the last change rolled back, with both changes kept in the history.
export const undo: FeatureDemo = {
  chatTitle: "Undo last change",
  user: { text: "Undo my last change" },
  working: { steps: ["Query Ledger", "Commit"], duration: "3s" },
  reply: { text: "Reverted. Your ledger is back to how it was, and the history keeps a record of both changes." },
};
