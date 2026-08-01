import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AddTransactionsResult, addBalanceAssertions } from "../ledger";
import { TOOL_LABELS } from "../tool-labels";

const Assertion = Type.Object({
  date: Type.String({ description: "Assertion date in YYYY-MM-DD format, usually today" }),
  account: Type.String({ description: "Account whose balance the user confirmed, e.g. Assets:Bank:Checking" }),
  balance: Type.Object(
    {
      amount: Type.Number({ description: "The confirmed total balance of the account" }),
      currency: Type.String({ description: "Currency code of the balance, e.g. USD, EUR" }),
    },
    { description: "The account's actual balance, as stated by the user" },
  ),
});

const Params = Type.Object({
  assertions: Type.Array(Assertion, { minItems: 1, description: "One or more balance assertions to record" }),
});

export const addBalanceAssertionsTool: ToolDefinition<typeof Params, AddTransactionsResult> = {
  name: "add_balance_assertions",
  label: TOOL_LABELS.add_balance_assertions,
  description:
    "Record balance assertions: standalone checkpoint entries stating each account's confirmed balance. " +
    "hledger verifies them on save and rejects the write when the ledger disagrees.",
  promptSnippet: "Record balance checkpoints when the user confirms an account's actual balance",
  promptGuidelines: [
    "Before calling add_balance_assertions, compare each stated balance with the ledger's balance for that account (query).",
    "A balance assertion is always a standalone entry — never attach it to a regular transaction.",
    "Record an assertion only once the ledger matches reality; hledger rejects an assertion that does not hold.",
  ],
  parameters: Params,

  async execute(_id, params, signal) {
    const result = await addBalanceAssertions(params.assertions, signal);

    let text: string;
    if (result.transactions.length === 1) {
      const tx = result.transactions[0];
      text = `Balance assertion saved to ${tx.fullFilePath}:\n\n${tx.transactionText}`;
    } else {
      const parts = result.transactions.map((tx, i) => `${i + 1}. ${tx.fullFilePath}:\n\n${tx.transactionText}`);
      text = `${result.transactions.length} balance assertions saved:\n\n${parts.join("\n\n")}`;
    }

    return {
      content: [{ type: "text", text }],
      details: result,
    };
  },
};
