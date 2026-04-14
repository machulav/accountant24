import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Box, Markdown } from "@mariozechner/pi-tui";

/** Renders "info" messages as markdown without the default [info] label. */
export function registerInfoMessageRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer("info", (message, _options, theme) => {
    const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
    box.addChild(
      new Markdown(text, 0, 0, getMarkdownTheme(), { color: (t: string) => theme.fg("customMessageText", t) }),
    );
    return box;
  });
}
