import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { ACCOUNTANT24_HOME } from "../config.js";
import { resolveSafePath, runCommand } from "./utils.js";

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

function buildArgs(params: any, resolved: string): string[] {
  const args = ["hledger", params.report, "-f", resolved];

  if (params.account_pattern) args.push(params.account_pattern);
  if (params.description_pattern) args.push(`desc:${params.description_pattern}`);
  if (params.payee_pattern) args.push(`payee:${params.payee_pattern}`);
  if (params.amount_filter) args.push(`amt:${params.amount_filter}`);
  if (params.tag) args.push(`tag:${params.tag}`);
  if (params.status === "cleared") args.push("status:*");
  else if (params.status === "pending") args.push("status:!");
  else if (params.status === "unmarked") args.push("status:");

  if (params.begin_date) args.push("-b", params.begin_date);
  if (params.end_date) args.push("-e", params.end_date);

  if (params.period) {
    const map: Record<string, string> = {
      daily: "--daily",
      weekly: "--weekly",
      monthly: "--monthly",
      quarterly: "--quarterly",
      yearly: "--yearly",
    };
    if (map[params.period]) args.push(map[params.period]);
  }

  if (params.depth != null) args.push("--depth", String(params.depth));
  if (params.invert) args.push("--invert");
  if (params.output_format) args.push("-O", params.output_format);

  return args;
}

export { buildArgs };

export const queryTool: AgentTool<typeof Params, null> = {
  name: "query",
  label: "Query Ledger",
  description:
    "Run an hledger report against the journal. Supports balance, register, income statement, balance sheet, and more with structured filters.",
  parameters: Params,
  async execute(_id, params, signal) {
    const file = params.file ?? "ledger/main.journal";
    const resolved = resolveSafePath(file, ACCOUNTANT24_HOME);

    const args = buildArgs(params, resolved);
    const { exitCode, stdout, stderr } = await runCommand(args, { signal });

    if (exitCode === 127) {
      throw new Error("hledger not found. Install: https://hledger.org/install");
    }

    if (exitCode === 0) {
      return { content: [{ type: "text", text: stdout || "(no results)" }], details: null };
    }

    const output = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(output);
  },
};
