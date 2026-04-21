import type { ExtensionFactory, SettingsManager } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { Loader } from "@mariozechner/pi-tui";
import { accountsCommand, memoryCommand, payeesCommand, tagsCommand } from "./commands";
import { listAccounts, listPayees, listTags } from "./ledger";
import { getMemory } from "./memory";
import { ensureScaffolded } from "./scaffold/scaffold";
import { getSystemPrompt } from "./system-prompt";
import {
  addTransactionTool,
  commitAndPushTool,
  copyFileToWorkspaceTool,
  extractTextTool,
  queryTool,
  updateMemoryTool,
  validateTool,
} from "./tools";
import { extractMeta, registerBuiltinOverrides } from "./tools/builtin-overrides";
import {
  AccountantAutocompleteProvider,
  createHeaderFactory,
  ModelFooter,
  registerInfoMessageRenderer,
  updateDisplay,
} from "./ui";

const LoaderProto = Loader.prototype as unknown as Record<string, any>;
LoaderProto.updateDisplay = updateDisplay;

export function createExtension(settingsManager: SettingsManager): ExtensionFactory {
  return (pi) => {
    let footer: ModelFooter | null = null;

    // Override built-in tools with custom rendering
    const builtinMeta = registerBuiltinOverrides(pi);

    // Register custom tools
    pi.registerTool(queryTool);
    pi.registerTool(addTransactionTool);
    pi.registerTool(commitAndPushTool);
    pi.registerTool(copyFileToWorkspaceTool);
    pi.registerTool(extractTextTool);
    pi.registerTool(validateTool);
    pi.registerTool(updateMemoryTool);

    // Collect prompt metadata from all tools (custom first, then built-in)
    const allToolMeta = [
      ...[
        queryTool,
        addTransactionTool,
        commitAndPushTool,
        copyFileToWorkspaceTool,
        extractTextTool,
        validateTool,
        updateMemoryTool,
      ].map(extractMeta),
      ...builtinMeta,
    ];

    // Register custom slash commands
    accountsCommand(pi);
    payeesCommand(pi);
    tagsCommand(pi);
    memoryCommand(pi);

    // Register custom message renderers
    registerInfoMessageRenderer(pi);

    // Shared autocomplete provider — updated with fresh data before each agent turn
    const autocomplete = new AccountantAutocompleteProvider([]);

    const TITLE = "Accountant24";
    const setTerminalTitle = () => process.stdout.write(`\x1b]0;${TITLE}\x07`);

    // Scaffold workspace + set up UI on session start
    pi.on("session_start", async (_event, ctx) => {
      await ensureScaffolded();

      if (ctx.hasUI) {
        // Override the framework's "π - dirname" title (runs after updateTerminalTitle)
        setTimeout(setTerminalTitle, 100);
        ctx.ui.setHeader(createHeaderFactory());
        ctx.ui.setFooter((tui, theme, _footerData) => {
          footer = new ModelFooter(tui, theme);
          if (ctx.model) footer.setModel(ctx.model.name);
          return footer;
        });

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
          footer?.setEditor(editor);
          return editor;
        });

        // Load initial data
        const [accounts, payees, tags] = await Promise.all([listAccounts(), listPayees(), listTags()]);
        autocomplete.setData(accounts, payees, tags);
      }
    });

    // Inject dynamic context into system prompt before each agent turn
    pi.on("before_agent_start", async (_event, ctx) => {
      const today = new Date().toISOString().split("T")[0];
      const [memory, accounts, payees, tags] = await Promise.all([
        getMemory(),
        listAccounts(),
        listPayees(),
        listTags(),
      ]);

      if (ctx.hasUI) {
        ctx.ui.setTitle(TITLE);
        ctx.ui.setWorkingMessage("Crunching the numbers...");
      }

      return { systemPrompt: getSystemPrompt({ today, memory, accounts, payees, tags, tools: allToolMeta }) };
    });

    // Maintain terminal title across agent lifecycle
    pi.on("agent_start", async (_event, ctx) => {
      if (ctx.hasUI) ctx.ui.setTitle(TITLE);
    });

    // Refresh autocomplete after each agent turn so new payees/accounts are available
    pi.on("agent_end", async (_event, ctx) => {
      if (ctx.hasUI) ctx.ui.setTitle(TITLE);
      const [accounts, payees, tags] = await Promise.all([listAccounts(), listPayees(), listTags()]);
      autocomplete.setData(accounts, payees, tags);
    });

    // Update footer when the user switches models
    pi.on("model_select", (event) => {
      footer?.setModel(event.model.name);
    });
  };
}
