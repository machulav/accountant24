import type { Agent } from "@mariozechner/pi-agent-core";
import {
  TUI,
  ProcessTerminal,
  Text,
  Editor,
  Container,
  matchesKey,
  CombinedAutocompleteProvider,
} from "@mariozechner/pi-tui";
import { setupChat } from "./chat.js";
import { createTheme } from "./theme.js";
import type { Theme } from "./theme.js";

function createLogo(theme: Theme): string {
  const c = theme.app.logo;
  const d = theme.app.logoTagline;
  return `
  ${c("██████")}  ${c("███████")} ${c(" █████")}  ${c("███   ██")} ${c(" ██████")} ${c("██")}      ${c(" █████")}  ${c("██     ██")}
  ${c("██   ██")} ${c("██")}      ${c("██   ██")} ${c("████  ██")} ${c("██")}      ${c("██")}      ${c("██   ██")} ${c("██     ██")}
  ${c("██████")}  ${c("█████")}   ${c("███████")} ${c("██ ██ ██")} ${c("██")}      ${c("██")}      ${c("███████")} ${c("██  █  ██")}
  ${c("██   ██")} ${c("██")}      ${c("██   ██")} ${c("██  ████")} ${c("██")}      ${c("██")}      ${c("██   ██")} ${c("██ ███ ██")}
  ${c("██████")}  ${c("███████")} ${c("██   ██")} ${c("██   ███")} ${c(" ██████")} ${c("███████")} ${c("██   ██")} ${c(" ███ ███")}

  ${d("Your personal AI accountant.")}
`;
}

export async function startApp(agent: Agent): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  const theme = createTheme();

  const welcome = new Text(createLogo(theme), 0, 1);
  tui.addChild(welcome);

  const chatContainer = new Container();
  tui.addChild(chatContainer);
  const editor = new Editor(tui, theme.editor);

  const autocomplete = new CombinedAutocompleteProvider([
    { name: "exit", description: "Exit BeanClaw" },
  ]);
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

    await agent.prompt(text);
  };

  tui.addChild(editor);
  tui.setFocus(editor);

  setupChat(agent, tui, chatContainer, editor, theme);

  tui.start();
}
