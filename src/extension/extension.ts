import type { ExtensionFactory, SettingsManager } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { Loader } from "@mariozechner/pi-tui";
import { AccountantAutocompleteProvider } from "./autocomplete";
import { accountsCommand, memoryCommand, payeesCommand, tagsCommand } from "./commands";
import { ensureScaffolded, getMemory, listAccounts, listPayees, listTags } from "./data";
import { createHeaderFactory } from "./headers";
import { registerInfoMessageRenderer } from "./message-renderers";
import { getSystemPrompt } from "./system-prompt";
import {
  addTransactionTool,
  commitAndPushTool,
  extractTextTool,
  queryTool,
  updateMemoryTool,
  validateTool,
} from "./tools";
import { registerBuiltinOverrides } from "./tools/builtin-overrides";

const CURRENCY_FRAMES = ["$", "€", "£", "¥", "₴"];
const LoaderProto = Loader.prototype as unknown as Record<string, any>;
LoaderProto.updateDisplay = function (this: Record<string, any>) {
  const frame = CURRENCY_FRAMES[Math.floor(this.currentFrame / 2) % CURRENCY_FRAMES.length];
  this.setText(`\x1b[32m${frame}\x1b[0m ${this.messageColorFn(this.message)}`);
  this.ui?.requestRender();
};

export function createExtension(settingsManager: SettingsManager): ExtensionFactory {
  return (pi) => {
    // Override built-in tools with custom rendering
    registerBuiltinOverrides(pi);

    // Register custom tools
    pi.registerTool(queryTool);
    pi.registerTool(addTransactionTool);
    pi.registerTool(commitAndPushTool);
    pi.registerTool(extractTextTool);
    pi.registerTool(validateTool);
    pi.registerTool(updateMemoryTool);

    // Register custom slash commands
    accountsCommand(pi);
    payeesCommand(pi);
    tagsCommand(pi);
    memoryCommand(pi);

    // Register custom message renderers
    registerInfoMessageRenderer(pi);

    // Shared autocomplete provider — updated with fresh data before each agent turn
    const autocomplete = new AccountantAutocompleteProvider([]);

    // Scaffold workspace + set up UI on session start
    pi.on("session_start", async (_event, ctx) => {
      await ensureScaffolded();

      if (ctx.hasUI) {
        ctx.ui.setTitle("Accountant24");
        ctx.ui.setHeader(createHeaderFactory());
        ctx.ui.setFooter(() => ({ render: () => [], invalidate() {} }));

        // Built-in commands (not exported by pi-coding-agent)
        const BUILTIN_COMMANDS = [
          { name: "new", description: "Start a new session" },
          { name: "resume", description: "Resume a different session" },
          { name: "model", description: "Select model" },
          { name: "login", description: "Login with OAuth provider" },
          { name: "logout", description: "Logout from OAuth provider" },
          { name: "session", description: "Show session info and stats" },
          { name: "hotkeys", description: "Show all keyboard shortcuts" },
          { name: "quit", description: "Quit Accountant24" },
        ];
        const extensionCommands = pi.getCommands().map((cmd) => ({
          name: cmd.name,
          description: cmd.description,
        }));
        const slashCommands = [...BUILTIN_COMMANDS, ...extensionCommands];
        autocomplete.setCommands(slashCommands);

        // Prevent the framework from overwriting our autocomplete provider
        // after the editor component factory runs.
        ctx.ui.setEditorComponent((tui, theme, keybindings) => {
          const editor = new CustomEditor(tui, theme, keybindings, {
            autocompleteMaxVisible: settingsManager.getAutocompleteMaxVisible(),
            paddingX: settingsManager.getEditorPaddingX(),
          });
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
      const [memory, accounts, payees, tags] = await Promise.all([
        getMemory(),
        listAccounts(),
        listPayees(),
        listTags(),
      ]);

      autocomplete.setData(accounts, payees, tags);

      if (ctx.hasUI) {
        ctx.ui.setWorkingMessage("Crunching the numbers...");
      }

      return { systemPrompt: getSystemPrompt({ today, memory, accounts, payees, tags }) };
    });
  };
}
