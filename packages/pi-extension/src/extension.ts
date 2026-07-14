import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { accountsCommand, memoryCommand, payeesCommand, tagsCommand } from "./commands";
import { listAccounts, listPayees, listTags } from "./ledger";
import { getMemory } from "./memory";
import { ensureScaffolded } from "./scaffold/scaffold";
import { buildContextSection, buildToolsSection, patchBakedDate } from "./system-prompt";
import {
  addTransactionsTool,
  commitAndPushTool,
  extractTextTool,
  queryTool,
  updateMemoryTool,
  validateTool,
} from "./tools";

// The desktop app renders all UI from the RPC event stream, so this extension
// registers only domain behavior — tools, commands, scaffolding, and the system
// prompt. No pi TUI customization (headers, footer, editor, autocomplete, etc.).
export function createAccountantExtension(pi: ExtensionAPI): void {
  // Register custom tools (pi registers its own built-in tools, bound to the agent
  // cwd, which the app sets to the workspace).
  pi.registerTool(queryTool);
  pi.registerTool(addTransactionsTool);
  pi.registerTool(commitAndPushTool);
  pi.registerTool(extractTextTool);
  pi.registerTool(validateTool);
  pi.registerTool(updateMemoryTool);

  // Register custom slash commands
  accountsCommand(pi);
  payeesCommand(pi);
  tagsCommand(pi);
  memoryCommand(pi);

  // Scaffold the workspace on session start
  pi.on("session_start", async () => {
    await ensureScaffolded();
  });

  // Extend pi's assembled base prompt before each agent turn. The base
  // (event.systemPrompt) already carries our system.md (loaded via
  // --system-prompt), pi's native <available_skills> block, and date/cwd lines —
  // so only the app-specific sections are appended here. The tool snippets +
  // guidelines come from pi's own systemPromptOptions, which reflects the
  // *enabled* tools (built-in + custom) — so toggling tools via pi flags is
  // honored here without hardcoding any tool list. pi bakes the date at session
  // setup and a desktop session can span days, so re-stamp it each turn.
  pi.on("before_agent_start", async (event) => {
    const today = new Date().toISOString().split("T")[0];
    const [memory, accounts, payees, tags] = await Promise.all([getMemory(), listAccounts(), listPayees(), listTags()]);

    const { selectedTools = [], toolSnippets = {}, promptGuidelines = [] } = event.systemPromptOptions;
    const tools = selectedTools
      .filter((name) => toolSnippets[name])
      .map((name) => ({ name, snippet: toolSnippets[name] }));

    return {
      systemPrompt:
        patchBakedDate(event.systemPrompt, today) +
        buildToolsSection(tools, promptGuidelines) +
        buildContextSection({ today, memory, accounts, payees, tags }),
    };
  });
}
