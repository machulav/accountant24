import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { addTransaction } from "../data";

const Posting = Type.Object({
  account: Type.String({ description: "Account name, e.g. Expenses:Food:Groceries" }),
  amount: Type.Optional(Type.Number({ description: "Amount (omit for auto-balance)" })),
  currency: Type.Optional(Type.String({ description: "Currency code, e.g. USD. Required when amount is provided" })),
});

const Params = Type.Object({
  date: Type.String({ description: "Transaction date in YYYY-MM-DD format" }),
  payee: Type.String({
    description:
      'Payee name, e.g. Whole Foods. Use exactly "Unknown" when the user does not know or remember the payee.',
  }),
  narration: Type.String({ description: "Transaction description" }),
  postings: Type.Array(Posting, { minItems: 2, description: "At least 2 postings; at most one may omit amount" }),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags (without #)" })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Optional key-value metadata" })),
});

export const addTransactionTool: ToolDefinition<typeof Params, null> = {
  name: "add_transaction",
  label: "Add Transaction",
  description: "Add a single transaction. Auto-routes to the correct monthly file and validates.",
  parameters: Params,
  async execute(_id, params, signal) {
    const result = await addTransaction(params, signal);

    return {
      content: [
        {
          type: "text",
          text: `Added transaction to ${result.relPath}:\n\n${result.txText}\n\nValidation: ${result.validationStatus}`,
        },
      ],
      details: null,
    };
  },
};
