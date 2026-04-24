import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { type AddTransactionsResult, addTransactions } from "../ledger";
import { createRenderCall, createRenderResult } from "./tool-renderer";

const Posting = Type.Object({
  account: Type.String({ description: "Account name, e.g. Expenses:Food:Groceries" }),
  amount: Type.Number({ description: "Amount — use negative for outflows (e.g. -45), positive for inflows" }),
  currency: Type.String({ description: "Currency code, e.g. USD, EUR" }),
});

const Tag = Type.Object({
  name: Type.String({ description: "Tag name, e.g. groceries, related_file" }),
  value: Type.Optional(Type.String({ description: "Tag value (omit for value-less tags)" })),
});

const Transaction = Type.Object({
  date: Type.String({ description: "Transaction date in YYYY-MM-DD format" }),
  payee: Type.String({
    description:
      'Payee name, e.g. Whole Foods. Use exactly "Unknown" when the user does not know or remember the payee.',
  }),
  description: Type.Optional(
    Type.String({ description: "Transaction description (omit when not provided by the user)" }),
  ),
  postings: Type.Array(Posting, {
    minItems: 2,
    description: "At least 2 postings with explicit amounts and currencies",
  }),
  tags: Type.Optional(
    Type.Array(Tag, {
      description:
        "Optional tags — each rendered as `; name:` or `; name: value`. The same name may appear multiple times.",
    }),
  ),
});

const Params = Type.Object({
  transactions: Type.Array(Transaction, {
    minItems: 1,
    description: "One or more transactions to add",
  }),
});

const LABEL = "Add Transactions";

export const addTransactionsTool: ToolDefinition<typeof Params, AddTransactionsResult> = {
  name: "add_transactions",
  label: LABEL,
  description: "Add one or more transactions. Auto-routes to the correct monthly files and validates.",
  promptSnippet: "Record transactions (auto-routes to monthly files, validates)",
  parameters: Params,

  renderCall: createRenderCall({ label: LABEL }),

  async execute(_id, params, signal) {
    const result = await addTransactions(params.transactions, signal);

    let text: string;
    if (result.transactions.length === 1) {
      const tx = result.transactions[0];
      text = `Transaction saved to ${tx.fullFilePath}:\n\n${tx.transactionText}`;
    } else {
      const parts = result.transactions.map((tx, i) => `${i + 1}. ${tx.fullFilePath}:\n\n${tx.transactionText}`);
      text = `${result.transactions.length} transactions saved:\n\n${parts.join("\n\n")}`;
    }

    return {
      content: [{ type: "text", text }],
      details: result,
    };
  },

  renderResult: createRenderResult<AddTransactionsResult>(({ details }) => {
    if (!details?.diffs) return [];
    return details.diffs.map((d) => ({
      heading: d.fullFilePath,
      content: d.diff,
      type: "diff" as const,
    }));
  }),
};
