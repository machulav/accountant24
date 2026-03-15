import type { Agent } from "@mariozechner/pi-agent-core";
import {
  TUI,
  Container,
  Markdown,
  CancellableLoader,
  Editor,
  Text,
} from "@mariozechner/pi-tui";
import type { Theme } from "./theme.js";
import {
  SPINNER_FRAMES,
  getToolLabel,
  formatToolSummary,
  renderToolLine,
} from "./chat.utils.js";

interface ToolCallEntry {
  text: Text;
  toolName: string;
  summary: string;
}

export function setupChat(
  agent: Agent,
  tui: TUI,
  chatContainer: Container,
  editor: Editor,
  theme: Theme,
): void {
  let streamingMarkdown: Markdown | null = null;
  let streamingText = "";
  let loader: CancellableLoader | null = null;

  const activeTools = new Map<string, ToolCallEntry>();
  let spinnerFrame = 0;
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;

  function startSpinner() {
    if (spinnerInterval) return;
    spinnerInterval = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
      for (const entry of activeTools.values()) {
        const icon = theme.app.toolSpinner(SPINNER_FRAMES[spinnerFrame]);
        const label = getToolLabel(entry.toolName);
        entry.text.setText(renderToolLine(icon, label, entry.summary, theme.app));
      }
      tui.requestRender();
    }, 80);
  }

  function stopSpinner() {
    if (spinnerInterval && activeTools.size === 0) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
  }

  agent.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        editor.disableSubmit = true;
        loader = new CancellableLoader(
          tui,
          theme.app.loaderActive,
          theme.app.loaderInactive,
          "Crunching numbers...",
        );
        loader.onAbort = () => agent.abort();
        chatContainer.addChild(loader);
        loader.start();
        tui.setFocus(loader);
        tui.requestRender();
        break;

      case "message_start":
        if (event.message.role === "assistant") {
          streamingText = "";
          streamingMarkdown = new Markdown("", 1, 1, theme.markdown);
          chatContainer.addChild(streamingMarkdown);
        }
        break;

      case "message_update":
        if (
          event.assistantMessageEvent.type === "text_delta" &&
          streamingMarkdown
        ) {
          streamingText += event.assistantMessageEvent.delta;
          streamingMarkdown.setText(streamingText);
          tui.requestRender();
        }
        break;

      case "tool_execution_start": {
        const label = getToolLabel(event.toolName);
        const summary = formatToolSummary(event.toolName, event.args);
        const icon = theme.app.toolSpinner(SPINNER_FRAMES[spinnerFrame]);
        const text = new Text(renderToolLine(icon, label, summary, theme.app), 1, 0);
        chatContainer.addChild(text);
        activeTools.set(event.toolCallId, { text, toolName: event.toolName, summary });
        startSpinner();
        tui.requestRender();
        break;
      }

      case "tool_execution_end": {
        const entry = activeTools.get(event.toolCallId);
        if (entry) {
          activeTools.delete(event.toolCallId);
          const label = getToolLabel(entry.toolName);
          const icon = event.isError ? theme.app.toolError("✗") : theme.app.toolIcon("✓");
          entry.text.setText(renderToolLine(icon, label, entry.summary, theme.app, event.isError));
          stopSpinner();
          tui.requestRender();
        }
        break;
      }

      case "agent_end":
        for (const entry of activeTools.values()) {
          const label = getToolLabel(entry.toolName);
          entry.text.setText(renderToolLine(theme.app.toolError("✗"), label, entry.summary, theme.app, true));
        }
        activeTools.clear();
        if (spinnerInterval) {
          clearInterval(spinnerInterval);
          spinnerInterval = null;
        }
        if (loader) {
          loader.stop();
          loader.dispose();
          chatContainer.removeChild(loader);
          loader = null;
        }
        streamingMarkdown = null;
        editor.disableSubmit = false;
        tui.setFocus(editor);
        tui.requestRender();
        break;
    }
  });
}
