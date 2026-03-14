import chalk from "chalk";
import type { Agent } from "@mariozechner/pi-agent-core";
import { TUI, Container, Markdown, Loader, Editor } from "@mariozechner/pi-tui";
import type { Theme } from "./theme.js";

export function setupChat(
  agent: Agent,
  tui: TUI,
  chatContainer: Container,
  editor: Editor,
  theme: Theme,
): void {
  let streamingMarkdown: Markdown | null = null;
  let streamingText = "";
  let loader: Loader | null = null;

  agent.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        editor.disableSubmit = true;
        loader = new Loader(tui, (s) => chalk.cyan(s), (s) => chalk.dim(s), "Thinking...");
        chatContainer.addChild(loader);
        loader.start();
        tui.requestRender();
        break;

      case "message_start":
        if (event.message.role === "assistant") {
          streamingText = "";
          streamingMarkdown = new Markdown("", 1, 0, theme.markdown);
          chatContainer.addChild(streamingMarkdown);
        }
        break;

      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta" && streamingMarkdown) {
          streamingText += event.assistantMessageEvent.delta;
          streamingMarkdown.setText(streamingText);
          tui.requestRender();
        }
        break;

      case "agent_end":
        if (loader) {
          loader.stop();
          chatContainer.removeChild(loader);
          loader = null;
        }
        streamingMarkdown = null;
        editor.disableSubmit = false;
        tui.requestRender();
        break;
    }
  });
}
