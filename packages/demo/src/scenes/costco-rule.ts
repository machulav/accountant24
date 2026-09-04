import type { FeatureDemo } from "../shared/types";

// Memory: a category correction is applied to past transactions and
// remembered for the next ones.
export const costcoRule: FeatureDemo = {
  chatTitle: "Costco is groceries",
  user: { text: "Costco is groceries, not shopping" },
  working: { steps: ["Bulk Edit Transactions", "Update Memory", "Commit"], duration: "5s" },
  reply: {
    text: "Moved 6 Costco transactions to groceries and noted the rule, so future Costco receipts go there too:",
    chips: [
      { kind: "payee", label: "Costco" },
      { kind: "account", label: "Expenses:Groceries" },
    ],
  },
};
