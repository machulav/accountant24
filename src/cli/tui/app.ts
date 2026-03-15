import chalk from "chalk";
import type { Agent } from "@mariozechner/pi-agent-core";
import { TUI, ProcessTerminal, Text, Editor, Container, matchesKey, CombinedAutocompleteProvider } from "@mariozechner/pi-tui";
import { setupChat } from "./chat.js";
import { createTheme } from "./theme.js";

const LOGO = `
  ${chalk.hex("#5B8DEF")("██████")}  ${chalk.hex("#5B8DEF")("███████")} ${chalk.hex("#5B8DEF")(" █████")}  ${chalk.hex("#5B8DEF")("███   ██")} ${chalk.hex("#5B8DEF")(" ██████")} ${chalk.hex("#5B8DEF")("██")}      ${chalk.hex("#5B8DEF")(" █████")}  ${chalk.hex("#5B8DEF")("██     ██")}
  ${chalk.hex("#5B8DEF")("██   ██")} ${chalk.hex("#5B8DEF")("██")}      ${chalk.hex("#5B8DEF")("██   ██")} ${chalk.hex("#5B8DEF")("████  ██")} ${chalk.hex("#5B8DEF")("██")}      ${chalk.hex("#5B8DEF")("██")}      ${chalk.hex("#5B8DEF")("██   ██")} ${chalk.hex("#5B8DEF")("██     ██")}
  ${chalk.hex("#5B8DEF")("██████")}  ${chalk.hex("#5B8DEF")("█████")}   ${chalk.hex("#5B8DEF")("███████")} ${chalk.hex("#5B8DEF")("██ ██ ██")} ${chalk.hex("#5B8DEF")("██")}      ${chalk.hex("#5B8DEF")("██")}      ${chalk.hex("#5B8DEF")("███████")} ${chalk.hex("#5B8DEF")("██  █  ██")}
  ${chalk.hex("#5B8DEF")("██   ██")} ${chalk.hex("#5B8DEF")("██")}      ${chalk.hex("#5B8DEF")("██   ██")} ${chalk.hex("#5B8DEF")("██  ████")} ${chalk.hex("#5B8DEF")("██")}      ${chalk.hex("#5B8DEF")("██")}      ${chalk.hex("#5B8DEF")("██   ██")} ${chalk.hex("#5B8DEF")("██ ███ ██")}
  ${chalk.hex("#5B8DEF")("██████")}  ${chalk.hex("#5B8DEF")("███████")} ${chalk.hex("#5B8DEF")("██   ██")} ${chalk.hex("#5B8DEF")("██   ███")} ${chalk.hex("#5B8DEF")(" ██████")} ${chalk.hex("#5B8DEF")("███████")} ${chalk.hex("#5B8DEF")("██   ██")} ${chalk.hex("#5B8DEF")(" ███ ███")}

  ${chalk.dim("Your personal AI accountant.")}
`;

export async function startApp(agent: Agent): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  const welcome = new Text(LOGO, 0, 1);
  tui.addChild(welcome);

  const chatContainer = new Container();
  tui.addChild(chatContainer);

  const theme = createTheme();
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

    const userMsg = new Text(text, 2, 0, (s) => chalk.bgHex("#2A2D3D").hex("#5B8DEF")(s));
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
