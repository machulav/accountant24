import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type QueryLedgerResult, queryLedger } from "../ledger";
import { createRenderCall, createRenderResult } from "./tool-renderer";

const Params = Type.Object({
  report: Type.Union(
    [
      Type.Literal("bal"),
      Type.Literal("reg"),
      Type.Literal("aregister"),
      Type.Literal("is"),
      Type.Literal("bs"),
      Type.Literal("print"),
      Type.Literal("stats"),
    ],
    {
      description:
        "Report type: bal (balances/spending), reg (posting list), aregister (single account with running balance), is (income statement), bs (balance sheet), print (raw transactions), stats (overview)",
    },
  ),
  account_pattern: Type.Optional(Type.String({ description: "Account name regex, e.g. 'Expenses:Food'" })),
  description_pattern: Type.Optional(Type.String({ description: "Filter by description regex" })),
  payee_pattern: Type.Optional(Type.String({ description: "Filter by payee regex (text before | in description)" })),
  amount_filter: Type.Optional(Type.String({ description: "Amount filter, e.g. '>100', '<50', '>=1000'" })),
  tag: Type.Optional(Type.String({ description: "Filter by tag, e.g. 'groceries' or 'source=manual'" })),
  status: Type.Optional(
    Type.Union([Type.Literal("cleared"), Type.Literal("pending"), Type.Literal("unmarked")], {
      description: "Transaction status filter",
    }),
  ),
  begin_date: Type.Optional(Type.String({ description: "Start date inclusive, YYYY-MM-DD" })),
  end_date: Type.Optional(Type.String({ description: "End date exclusive, YYYY-MM-DD" })),
  period: Type.Optional(
    Type.Union(
      [
        Type.Literal("daily"),
        Type.Literal("weekly"),
        Type.Literal("monthly"),
        Type.Literal("quarterly"),
        Type.Literal("yearly"),
      ],
      { description: "Period grouping for multi-period reports" },
    ),
  ),
  depth: Type.Optional(
    Type.Number({ description: "Account depth limit (2 = Expenses:Food, not Expenses:Food:Groceries)" }),
  ),
  invert: Type.Optional(Type.Boolean({ description: "Flip signs — show expenses as positive (--invert)" })),
  output_format: Type.Optional(
    Type.Union([Type.Literal("txt"), Type.Literal("csv"), Type.Literal("json"), Type.Literal("tsv")], {
      description: "Output format. csv/json/tsv for machine-readable data",
    }),
  ),
  file: Type.Optional(
    Type.String({ description: "Journal file relative to ~/accountant24 (default: ledger/main.journal)" }),
  ),
});

const LABEL = "Query Ledger";

export const queryTool: ToolDefinition<typeof Params, QueryLedgerResult> = {
  name: "query",
  label: LABEL,
  description:
    "Run an hledger report against the journal. Supports balance, register, income statement, balance sheet, and more with structured filters.",
  parameters: Params,

  renderCall: createRenderCall({ label: LABEL }),

  async execute(_id, params, signal) {
    const result = await queryLedger(params, signal);

    return {
      content: [
        {
          type: "text",
          text: result.output,
        },
      ],
      details: result,
    };
  },

  renderResult: createRenderResult<QueryLedgerResult>(({ details }) => [
    { heading: "Command", content: details?.command ?? "" },
    { heading: "Output", content: details?.output ?? "" },
  ]),
};
