import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ACCOUNTANT24_HOME, LEDGER_DIR } from "../config.js";
import { HledgerCommandError, HledgerNotFoundError, hledgerCheck } from "./hledger.js";
import { resolveSafePath } from "./utils.js";

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

function validateInputs(params: { date: string; postings: any[] }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    throw new Error(`Invalid date format: ${params.date}. Expected YYYY-MM-DD.`);
  }
  if (params.postings.length < 2) {
    throw new Error("At least 2 postings are required.");
  }
  const blanks = params.postings.filter((p: any) => p.amount == null);
  if (blanks.length > 1) {
    throw new Error("At most one posting may omit the amount.");
  }
  for (const p of params.postings) {
    if (p.amount != null && !p.currency) {
      throw new Error(`Posting for ${p.account} has amount but no currency.`);
    }
  }
}

function formatTransaction(params: {
  date: string;
  payee: string;
  narration: string;
  postings: any[];
  tags?: string[];
  metadata?: Record<string, string>;
}): string {
  const header = `${params.date} * ${params.payee} | ${params.narration}`;

  const lines = [header];

  if (params.tags?.length) {
    lines.push(`    ; ${params.tags.map((t) => `${t}:`).join(", ")}`);
  }

  if (params.metadata) {
    for (const [key, value] of Object.entries(params.metadata)) {
      lines.push(`    ; ${key}: ${value}`);
    }
  }

  for (const p of params.postings) {
    if (p.amount != null) {
      lines.push(`    ${p.account}    ${p.amount.toFixed(2)} ${p.currency}`);
    } else {
      lines.push(`    ${p.account}`);
    }
  }

  return lines.join("\n");
}

export const addTransactionTool: ToolDefinition<typeof Params, null> = {
  name: "add_transaction",
  label: "Add Transaction",
  description: "Add a single transaction. Auto-routes to the correct monthly file and validates.",
  parameters: Params,
  async execute(_id, params, signal) {
    validateInputs(params);

    const txText = formatTransaction(params);

    // Route to monthly file
    const [year, month] = params.date.split("-");
    const relPath = `ledger/${year}/${month}.journal`;
    const absPath = resolveSafePath(`${year}/${month}.journal`, LEDGER_DIR);
    const mainPath = join(LEDGER_DIR, "main.journal");

    // Ensure directory exists
    mkdirSync(dirname(absPath), { recursive: true });

    // Append or create
    const isNew = !existsSync(absPath);
    if (isNew) {
      writeFileSync(absPath, `${txText}\n`);
    } else {
      const existing = readFileSync(absPath, "utf-8");
      const separator = existing.endsWith("\n") ? "\n" : "\n\n";
      writeFileSync(absPath, `${existing}${separator}${txText}\n`);
    }

    // Update includes if new file
    if (isNew && existsSync(mainPath)) {
      const mainContent = readFileSync(mainPath, "utf-8");
      const includeDirective = `include ${year}/${month}.journal`;
      if (!mainContent.includes(includeDirective)) {
        const sep = mainContent.endsWith("\n") ? "" : "\n";
        writeFileSync(mainPath, `${mainContent}${sep}${includeDirective}\n`);
      }
    }

    // Ensure commodity declarations exist for strict validation
    if (existsSync(mainPath)) {
      const mainContent = readFileSync(mainPath, "utf-8");
      const currencies = new Set(params.postings.filter((p: any) => p.currency).map((p: any) => p.currency));
      const missingCommodities: string[] = [];
      for (const cur of currencies) {
        const pattern = new RegExp(`^commodity\\s+.*${cur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
        if (!pattern.test(mainContent)) {
          missingCommodities.push(cur);
        }
      }
      if (missingCommodities.length > 0) {
        const declarations = missingCommodities.map((c) => `commodity ${c}`).join("\n");
        writeFileSync(mainPath, `${declarations}\n\n${mainContent}`);
      }
    }

    // Validate
    let validationStatus = "Valid.";
    try {
      await hledgerCheck(mainPath, { cwd: ACCOUNTANT24_HOME, signal });
    } catch (e) {
      if (e instanceof HledgerNotFoundError) {
        validationStatus = "hledger not found, skipped validation.";
      } else if (e instanceof HledgerCommandError) {
        throw new Error(`Validation failed:\n${e.message}\n\nTransaction was written to ${relPath} but has errors.`);
      } else {
        throw e;
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Added transaction to ${relPath}:\n\n${txText}\n\nValidation: ${validationStatus}`,
        },
      ],
      details: null,
    };
  },
};
