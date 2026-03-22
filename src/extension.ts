import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { createBriefingFactory } from "./cli/tui/briefing.js";
import { getBaseSystemPrompt, loadSystemPromptContext } from "./core/agent/system-prompt.js";
import { ACCOUNTANT24_HOME, LEDGER_DIR } from "./core/config.js";
import { addTransactionTool } from "./core/tools/add-transaction.js";
import { queryTool } from "./core/tools/query.js";
import { updateMemoryTool } from "./core/tools/update-memory.js";
import { validateTool } from "./core/tools/validate.js";

const DEFAULT_ACCOUNTS = [
  "Assets:Checking",
  "Assets:Savings",
  "Assets:Cash",
  "Liabilities:CreditCard",
  "Income:Salary",
  "Income:Other",
  "Expenses:Groceries",
  "Expenses:Rent",
  "Expenses:Utilities",
  "Expenses:Transport",
  "Expenses:Dining",
  "Expenses:Entertainment",
  "Expenses:Health",
  "Expenses:Shopping",
  "Expenses:Other",
  "Equity:Opening-Balances",
];

function ensureScaffolded(): void {
  const mainJournal = join(LEDGER_DIR, "main.journal");
  if (existsSync(mainJournal)) return;

  for (const dir of ["ledger", "documents", ".sessions"]) {
    mkdirSync(join(ACCOUNTANT24_HOME, dir), { recursive: true });
  }

  const accountLines = DEFAULT_ACCOUNTS.map((a) => `account ${a}`).join("\n");
  writeFileSync(join(LEDGER_DIR, "accounts.journal"), `${accountLines}\n`);
  writeFileSync(mainJournal, "; Accountant24 Personal Finances\n\ninclude accounts.journal\n");
  writeFileSync(join(ACCOUNTANT24_HOME, "memory.json"), `${JSON.stringify({ facts: [] }, null, 2)}\n`);
  writeFileSync(join(ACCOUNTANT24_HOME, ".gitignore"), ".sessions/\n");
}

export const accountant24Extension: ExtensionFactory = (pi) => {
  // Register domain tools
  pi.registerTool(queryTool);
  pi.registerTool(addTransactionTool);
  pi.registerTool(validateTool);
  pi.registerTool(updateMemoryTool);

  // Scaffold workspace + set up briefing header on session start
  pi.on("session_start", async (_event, ctx) => {
    ensureScaffolded();

    if (ctx.hasUI) {
      ctx.ui.setHeader(createBriefingFactory());
    }
  });

  // Store sessions in accountant24 workspace
  pi.on("session_directory", () => ({
    sessionDir: join(ACCOUNTANT24_HOME, ".sessions"),
  }));

  // Inject dynamic context into system prompt before each agent turn
  pi.on("before_agent_start", async () => {
    const context = await loadSystemPromptContext();
    const parts: string[] = [getBaseSystemPrompt()];

    parts.push(`\n<session>\nToday's date: ${context.today}\n</session>`);
    if (context.facts.length > 0) {
      parts.push(`\n<memory>\nUser facts:\n${context.facts.map((f) => `- ${f}`).join("\n")}\n</memory>`);
    }
    if (context.accounts.length > 0) {
      parts.push(`\n<accounts>\nKnown accounts:\n${context.accounts.join("\n")}\n</accounts>`);
    }
    if (context.payees.length > 0) {
      parts.push(`\n<known-payees>\nAll payees in the journal:\n${context.payees.join("\n")}\n</known-payees>`);
    }

    return { systemPrompt: parts.join("") };
  });
};
