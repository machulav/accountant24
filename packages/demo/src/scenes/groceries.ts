import type { FeatureDemo } from "../shared/types";

// Natural language entry: a plain sentence becomes a double-entry
// transaction, with payee and accounts as inline chips.
export const groceries: FeatureDemo = {
  chatTitle: "Groceries at Trader Joe's",
  user: { text: "I paid $42.50 cash for groceries at Trader Joe's yesterday" },
  working: { steps: ["Add Transactions", "Commit"], duration: "3s" },
  reply: {
    text: "Recorded. $42.50 at :payee[Trader Joe's] went to :account[Expenses:Groceries], paid from :account[Assets:Cash].",
  },
};
