import { join } from "node:path";
import type { Agent } from "@mariozechner/pi-agent-core";
import { CombinedAutocompleteProvider, Editor, matchesKey, ProcessTerminal, Text, TUI } from "@mariozechner/pi-tui";
import { LEDGER_DIR } from "../../core/config.js";
import { Briefing, buildHeaderLine } from "./briefing.js";
import { fetchBriefingData } from "./briefing-data.js";
import { setupChat } from "./chat.js";
import { GapContainer } from "./gap-container.js";
import type { Theme } from "./theme.js";
import { createTheme } from "./theme.js";

export function createLogo(theme: Theme): string {
  const width = process.stdout.columns || 80;
  return `\n${theme.briefing.header(buildHeaderLine("Accountant24", width))}\n`;
}

export async function startApp(agent: Agent, opts?: { showLogo?: boolean }): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  const theme = createTheme();

  if (opts?.showLogo !== false) {
    const briefing = new Briefing(theme);
    tui.addChild(briefing);

    const journalPath = join(LEDGER_DIR, "main.journal");
    fetchBriefingData(journalPath)
      .then((data) => {
        briefing.setData(data);
        tui.requestRender();
      })
      .catch(() => {
        briefing.setData({
          netWorth: null,
          spendThisMonth: null,
          incomeThisMonth: null,
          recentTransactions: [],
          topCategories: [],
          error: "Failed to load financial data.",
        });
        tui.requestRender();
      });
  }

  const chatContainer = new GapContainer(1, 1);
  tui.addChild(chatContainer);
  const editor = new Editor(tui, theme.editor);

  const autocomplete = new CombinedAutocompleteProvider([{ name: "exit", description: "Exit Accountant24" }]);
  editor.setAutocompleteProvider(autocomplete);

  function shutdown() {
    agent.abort();
    tui.stop();
    process.exit(0);
  }

  tui.addInputListener((data) => {
    if (matchesKey(data, "ctrl+c")) {
      shutdown();
      return { consume: true };
    }
    return undefined;
  });

  editor.onSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (trimmed === "/exit") {
      shutdown();
      return;
    }

    const userMsg = new Text(text, 2, 0, theme.app.userMessage);
    chatContainer.addChild(userMsg);
    editor.addToHistory(text);
    tui.requestRender();

    try {
      await agent.prompt(text);
    } catch (err) {
      const icon = theme.app.toolError("✗");
      const label = theme.app.toolError("Error");
      const detail = theme.app.toolArgs(err instanceof Error ? err.message : String(err));
      const errText = new Text(` ${icon} ${label}  ${detail}`, 1, 0);
      chatContainer.addChild(errText);
      tui.requestRender();
    }
  };

  tui.addChild(editor);
  tui.setFocus(editor);

  setupChat(agent, tui, chatContainer, editor, theme);

  tui.start();
}
