import type { FeatureDemo } from "../shared/types";

// A question over the ledger, answered as a table.
export const lastMonth: FeatureDemo = {
  chatTitle: "Last month spending",
  user: { text: "Where did my money go last month?" },
  working: { steps: ["Query Ledger"], duration: "4s" },
  reply: {
    text: "Most of it went to rent and groceries:",
    table: {
      head: ["Account", "August"],
      rows: [
        ["Rent", "$1,850.00"],
        ["Groceries", "$612.30"],
        ["Restaurants", "$285.90"],
        ["Gas", "$184.50"],
      ],
    },
  },
};
