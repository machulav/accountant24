import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";
import { accountsCommand, memoryCommand, payeesCommand, tagsCommand } from "./commands";
import { listAccounts, listPayees, listTags } from "./ledger";
import { getMemory } from "./memory";
import { ensureScaffolded } from "./scaffold/scaffold";
import { getSystemPrompt } from "./system-prompt";
import {
  addTransactionsTool,
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

// pi defaults — formerly read from SettingsManager, which the standalone extension
// no longer receives. The TUI-only editor below uses them when ctx.hasUI.
const AUTOCOMPLETE_MAX_VISIBLE = 5;
const EDITOR_PADDING_X = 0;

export function createAccountantExtension(pi: ExtensionAPI): void {
  {
    let footer: ModelFooter | null = null;

    // Override built-in tools with custom rendering
    const builtinMeta = registerBuiltinOverrides(pi);

    // Register custom tools
    pi.registerTool(queryTool);
    pi.registerTool(addTransactionsTool);
    pi.registerTool(commitAndPushTool);
    pi.registerTool(copyFileToWorkspaceTool);
    pi.registerTool(extractTextTool);
    pi.registerTool(validateTool);
    pi.registerTool(updateMemoryTool);

    // Collect prompt metadata from all tools (custom first, then built-in)
    const allToolMeta = [
      ...[
        queryTool,
        addTransactionsTool,
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

    // Shared autocomplete provider — updated with fresh data before each agent turn.
    // Decorates the built-in provider: we handle @ mentions, it handles slash commands.
    const autocomplete = new AccountantAutocompleteProvider();
    let autocompleteRegistered = false;

    const TITLE = "Accountant24";
    // Terminal-title escapes are only meaningful on a real TTY. Under stock pi's RPC
    // mode `ctx.hasUI` is true (pi bridges UI calls to RPC events), but stdout is a
    // pipe carrying JSONL — writing escapes there corrupts the stream. Guard on isTTY.
    const setTerminalTitle = () => {
      if (process.stdout.isTTY) process.stdout.write(`\x1b]0;${TITLE}\x07`);
    };

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

        // Curated slash-command list — only the commands we want to expose
        // (the framework's built-in command names are not exported, so we list them).
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
        autocomplete.setCommands([...BUILTIN_COMMANDS, ...extensionCommands]);

        // Decorate the built-in provider: we serve @ mentions and our curated
        // slash list; file-path completion is delegated to the built-in provider.
        // addAutocompleteProvider re-applies us to the editor (no monkey-patch needed).
        if (!autocompleteRegistered) {
          autocompleteRegistered = true;
          ctx.ui.addAutocompleteProvider((current) => {
            autocomplete.setDelegate(current);
            return autocomplete;
          });
        }

        ctx.ui.setEditorComponent((tui, theme, keybindings) => {
          const editor = new CustomEditor(tui, theme, keybindings, {
            autocompleteMaxVisible: AUTOCOMPLETE_MAX_VISIBLE,
            paddingX: EDITOR_PADDING_X,
          });
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
  }
}
