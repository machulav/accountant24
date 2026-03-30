import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";

export interface RenderCallOptions {
  label: string;
  expandable?: boolean;
}

export interface ToolRenderSection {
  heading: string;
  content: string;
}

const EMPTY_TEXT = new Text("", 0, 0);

export function createRenderCall(options: RenderCallOptions) {
  return (
    _args: any,
    theme: Theme,
    context: {
      lastComponent: Component | undefined;
      executionStarted: boolean;
      isPartial: boolean;
      isError: boolean;
    },
  ) => {
    const text = (context.lastComponent as Text) ?? new Text("", 0, 0);
    const done = context.executionStarted && !context.isPartial;

    if (done && context.isError) {
      text.setText(`${theme.fg("error", theme.bold(options.label))} ${theme.fg("muted", "(ctrl+o to expand)")}`);
    } else if (done) {
      const hint = options.expandable !== false ? ` ${theme.fg("muted", "(ctrl+o to expand)")}` : "";
      text.setText(`${theme.fg("toolTitle", theme.bold(options.label))}${hint}`);
    } else {
      text.setText(theme.fg("toolTitle", theme.bold(options.label)));
    }
    return text;
  };
}

export function createRenderResult<TDetails>(
  getSections: (result: { content: Array<{ type: string; text?: string }>; details: TDetails }) => ToolRenderSection[],
) {
  return (
    result: any,
    { isPartial, expanded }: { isPartial: boolean; expanded: boolean },
    theme: Theme,
    context?: { isError: boolean },
  ) => {
    if (isPartial || !expanded) return EMPTY_TEXT;

    let sections: ToolRenderSection[];
    if (context?.isError) {
      const errorText = result.content?.[0]?.type === "text" ? (result.content[0].text ?? "") : "";
      sections = [{ heading: "Error", content: errorText }];
    } else {
      sections = getSections(result);
    }
    if (sections.length === 0) return EMPTY_TEXT;

    const isError = context?.isError ?? false;
    const PAD = "  ";
    const headingColor = isError ? "error" : "mdHeading";
    const heading = (s: string) => theme.fg(headingColor, theme.bold(s));
    const textColor = isError ? "error" : "toolOutput";
    const lines: string[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (i > 0) lines.push("");
      if (section.heading) lines.push(`${PAD}${heading(section.heading)}`, "");
      for (const line of section.content.trimEnd().split("\n")) {
        lines.push(`${PAD}${theme.fg(textColor, line)}`);
      }
    }

    lines.unshift("");

    let cachedWidth = -1;
    let cachedLines: string[] = [];
    return {
      render: (width: number) => {
        if (width !== cachedWidth) {
          cachedWidth = width;
          cachedLines = lines.map((l) => truncateToWidth(l, width));
        }
        return cachedLines;
      },
      invalidate: () => {
        cachedWidth = -1;
      },
    };
  };
}
