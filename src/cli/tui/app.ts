import type { Agent } from "@mariozechner/pi-agent-core";
import { TUI, ProcessTerminal, Text, Editor, Container } from "@mariozechner/pi-tui";
import { setupChat } from "./chat.js";
import { createTheme } from "./theme.js";

export async function startApp(agent: Agent): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  const welcome = new Text("BeanClaw — Personal Finance Assistant\n", 1, 1);
  tui.addChild(welcome);

  const chatContainer = new Container();
  tui.addChild(chatContainer);

  const theme = createTheme();
  const editor = new Editor(tui, theme.editor);

  editor.onSubmit = async (text: string) => {
    if (!text.trim()) return;

    const userMsg = new Text(`> ${text}\n`, 1, 0);
    chatContainer.addChild(userMsg);
    tui.requestRender();

    await agent.prompt(text);
  };

  tui.addChild(editor);
  tui.setFocus(editor);

  setupChat(agent, tui, chatContainer, editor, theme);

  tui.start();
}
