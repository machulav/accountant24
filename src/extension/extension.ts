import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { Loader } from "@mariozechner/pi-tui";
import { AccountantAutocompleteProvider } from "./autocomplete.js";
import { accountsCommand, payeesCommand } from "./commands";
import { ACCOUNTANT24_HOME, LEDGER_DIR } from "./config.js";
import { loadAccounts, loadPayees } from "./context";
import { createBriefingFactory } from "./headers/briefing/briefing.js";
import { buildSystemPrompt } from "./system-prompt";
import { addTransactionTool, queryTool, updateMemoryTool, validateTool } from "./tools";

// Custom currency-symbol loader animation in green
const CURRENCY_FRAMES = ["$", "€", "£", "¥", "₴"];
const LoaderProto = Loader.prototype as unknown as Record<string, any>;
LoaderProto.updateDisplay = function (this: Record<string, any>) {
  const frame = CURRENCY_FRAMES[Math.floor(this.currentFrame / 2) % CURRENCY_FRAMES.length];
  this.setText(`\x1b[32m${frame}\x1b[0m ${this.messageColorFn(this.message)}`);
  this.ui?.requestRender();
};

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
  writeFileSync(join(ACCOUNTANT24_HOME, ".gitignore"), ".sessions/\nauth.json\n");
}

export const accountant24Extension: ExtensionFactory = (pi) => {
  // Register domain tools
  pi.registerTool(queryTool);
  pi.registerTool(addTransactionTool);
  pi.registerTool(validateTool);
  pi.registerTool(updateMemoryTool);

  // Register slash commands
  accountsCommand(pi);
  payeesCommand(pi);

  // Shared autocomplete provider — updated with fresh data before each agent turn
  const autocomplete = new AccountantAutocompleteProvider([]);

  // Scaffold workspace + set up UI on session start
  pi.on("session_start", async (_event, ctx) => {
    ensureScaffolded();

    if (ctx.hasUI) {
      ctx.ui.setTitle("Accountant24");
      ctx.ui.setHeader(createBriefingFactory());
      ctx.ui.setFooter(() => ({ render: () => [], invalidate() {} }));

      // Built-in commands (not exported by pi-coding-agent)
      const BUILTIN_COMMANDS = [
        { name: "settings", description: "Open settings menu" },
        { name: "model", description: "Select model" },
        { name: "session", description: "Show session info and stats" },
        { name: "hotkeys", description: "Show all keyboard shortcuts" },
        { name: "login", description: "Login with OAuth provider" },
        { name: "logout", description: "Logout from OAuth provider" },
        { name: "new", description: "Start a new session" },
        { name: "resume", description: "Resume a different session" },
        { name: "quit", description: "Quit Accountant24" },
      ];
      const extensionCommands = pi.getCommands().map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
      }));
      const slashCommands = [...BUILTIN_COMMANDS, ...extensionCommands];
      autocomplete.setCommands(slashCommands);

      // Replace file-search editor with payee/account autocomplete
      // InteractiveMode's setCustomEditorComponent overwrites the autocomplete provider
      // after the factory runs (line 1357 in interactive-mode.js), so we lock ours in.
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        const editor = new CustomEditor(tui, theme, keybindings);
        editor.setAutocompleteProvider(autocomplete);
        editor.setAutocompleteProvider = () => {}; // prevent overwrite
        return editor;
      });

      // Load initial data
      const [accounts, payees] = await Promise.all([loadAccounts(), loadPayees()]);
      autocomplete.setData(accounts, payees);
    }
  });

  // Inject dynamic context into system prompt before each agent turn
  // Also refresh autocomplete data with latest payees/accounts
  pi.on("before_agent_start", async (_event, ctx) => {
    const [systemPrompt, accounts, payees] = await Promise.all([buildSystemPrompt(), loadAccounts(), loadPayees()]);
    autocomplete.setData(accounts, payees);
    if (ctx.hasUI) {
      ctx.ui.setWorkingMessage("Crunching the numbers...");
    }
    return { systemPrompt };
  });
};
