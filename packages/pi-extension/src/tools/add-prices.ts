import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AddTransactionsResult, addPrices } from "../ledger";
import { TOOL_LABELS } from "../tool-labels";

const Price = Type.Object({
  date: Type.String({ description: "Date the rate was observed, in YYYY-MM-DD format, usually today" }),
  commodity: Type.String({ description: "Commodity being priced, e.g. USD, BTC, AAPL" }),
  price: Type.Object(
    {
      amount: Type.Number({ description: "Price of one unit of the commodity" }),
      currency: Type.String({ description: "Currency the price is quoted in, e.g. EUR" }),
    },
    { description: "The market price of one unit of the commodity" },
  ),
});

const Params = Type.Object({
  prices: Type.Array(Price, { minItems: 1, description: "One or more market prices to record" }),
});

export const addPricesTool: ToolDefinition<typeof Params, AddTransactionsResult> = {
  name: "add_prices",
  label: TOOL_LABELS.add_prices,
  description:
    "Record market prices (hledger P directives): what one unit of a commodity was worth on a date. " +
    "Auto-routes to the correct monthly files and validates.",
  promptSnippet: "Record market prices when the user states a current rate or asset price",
  promptGuidelines: [
    "Record prices toward the user's main currency; the Net Worth report values every holding at its latest recorded price.",
    "A price is a standalone P directive, not a transaction. Record one when the user states a rate; purchases already imply prices through their cost.",
  ],
  parameters: Params,

  async execute(_id, params, signal) {
    const result = await addPrices(params.prices, signal);

    let text: string;
    if (result.transactions.length === 1) {
      const price = result.transactions[0];
      text = `Price saved to ${price.fullFilePath}:\n\n${price.transactionText}`;
    } else {
      const parts = result.transactions.map(
        (price, i) => `${i + 1}. ${price.fullFilePath}:\n\n${price.transactionText}`,
      );
      text = `${result.transactions.length} prices saved:\n\n${parts.join("\n\n")}`;
    }

    return {
      content: [{ type: "text", text }],
      details: result,
    };
  },
};
