import type { HeroDemo } from "../shared/types";

// The hero conversation: three statements dropped in, imported and reconciled,
// then a net-worth question that shows the fresh investment prices paying off.
export const augustStatements: HeroDemo = {
  chatTitle: "August statements",
  turns: [
    {
      user: {
        text: "Import my August statements",
        attachments: [
          { name: "chase-aug.pdf", meta: "PDF · 312 KB" },
          { name: "amex-aug.csv", meta: "CSV · 41 KB" },
          { name: "fidelity-aug.pdf", meta: "PDF · 188 KB" },
        ],
      },
      working: {
        steps: ["Extract Text", "Add Transactions", "Add Balance Assertions", "Add Prices", "Commit"],
        duration: "14s",
      },
      reply: {
        text: "Imported 61 transactions from three statements. Balances match, and your Fidelity investments are up to date as of August 31.\n\nThree things I noticed:",
        bullets: [
          "Your $412 :payee[Delta] refund came through. I linked it to the original transaction, as you asked.",
          ":payee[Netflix] charged $17.99, up from $15.49 last month.",
          "I don't see August rent in these statements. You usually pay it by the end of the month.",
        ],
      },
    },
    {
      user: { text: "What's my net worth now?" },
      working: { steps: ["Query Ledger"], duration: "3s" },
      reply: {
        text: "$84,310, up $1,240 since July. Investments gained $1,620, cash and cards slipped a little:",
        table: {
          head: ["Account", "Balance", "Change"],
          rows: [
            ["Cash", "$12,450", "-$310"],
            ["Investments", "$73,600", "+$1,620"],
            ["Credit cards", "-$1,740", "-$70"],
          ],
        },
      },
    },
  ],
};
