import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { Loader } from "@mariozechner/pi-tui";
import { AccountantAutocompleteProvider } from "./autocomplete";
import { accountsCommand, payeesCommand, tagsCommand } from "./commands";
import { ensureScaffolded, getMemory, listAccounts, listPayees, listTags } from "./data";
import { createBriefingFactory } from "./headers/briefing/briefing";
import { getSystemPrompt } from "./system-prompt";
import { addTransactionTool, queryTool, updateMemoryTool, validateTool } from "./tools";

// Custom currency-symbol loader animation in green
const CURRENCY_FRAMES = ["$", "€", "£", "¥", "₴"];
const LoaderProto = Loader.prototype as unknown as Record<string, any>;
LoaderProto.updateDisplay = function (this: Record<string, any>) {
  const frame = CURRENCY_FRAMES[Math.floor(this.currentFrame / 2) % CURRENCY_FRAMES.length];
  this.setText(`\x1b[32m${frame}\x1b[0m ${this.messageColorFn(this.message)}`);
  this.ui?.requestRender();
};

export const accountant24Extension: ExtensionFactory = (pi) => {
  // Register domain tools
  pi.registerTool(queryTool);
  pi.registerTool(addTransactionTool);
  pi.registerTool(validateTool);
  pi.registerTool(updateMemoryTool);

  // Register slash commands
  accountsCommand(pi);
  payeesCommand(pi);
  tagsCommand(pi);

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
      const [accounts, payees, tags] = await Promise.all([listAccounts(), listPayees(), listTags()]);
      autocomplete.setData(accounts, payees, tags);
    }
  });

  // Inject dynamic context into system prompt before each agent turn
  // Also refresh autocomplete data with latest payees/accounts
  pi.on("before_agent_start", async (_event, ctx) => {
    const today = new Date().toISOString().split("T")[0];
    const [memory, accounts, payees, tags] = await Promise.all([getMemory(), listAccounts(), listPayees(), listTags()]);

    autocomplete.setData(accounts, payees, tags);

    if (ctx.hasUI) {
      ctx.ui.setWorkingMessage("Crunching the numbers...");
    }

    return { systemPrompt: getSystemPrompt({ today, memory, accounts, payees, tags }) };
  });
};
