import { describe, expect, mock, test } from "bun:test";
import { Box, Markdown } from "@mariozechner/pi-tui";
import { registerInfoMessageRenderer } from "../message-renderers";

type Renderer = (...args: any[]) => any;

function createMockPi() {
  const renderers = new Map<string, Renderer>();
  return {
    registerMessageRenderer: mock((type: string, renderer: Renderer) => {
      renderers.set(type, renderer);
    }),
    renderers,
  };
}

function createMockTheme() {
  return {
    bg: mock((_color: string, text: string) => text),
    fg: mock((_color: string, text: string) => text),
  };
}

function getRenderer(pi: ReturnType<typeof createMockPi>): Renderer {
  const renderer = pi.renderers.get("info");
  if (!renderer) throw new Error("info renderer not registered");
  return renderer;
}

describe("registerInfoMessageRenderer()", () => {
  test("should register a renderer for 'info' customType", () => {
    const pi = createMockPi();
    registerInfoMessageRenderer(pi as any);
    expect(pi.registerMessageRenderer).toHaveBeenCalledTimes(1);
    expect(pi.registerMessageRenderer.mock.calls[0][0]).toBe("info");
  });

  test("should return a Box component", () => {
    const pi = createMockPi();
    registerInfoMessageRenderer(pi as any);
    const renderer = getRenderer(pi);
    const result = renderer({ content: "hello", customType: "info" }, { expanded: false }, createMockTheme());
    expect(result).toBeInstanceOf(Box);
  });

  test("should contain a Markdown child for string content", () => {
    const pi = createMockPi();
    registerInfoMessageRenderer(pi as any);
    const renderer = getRenderer(pi);
    const box = renderer({ content: "# Hello", customType: "info" }, { expanded: false }, createMockTheme()) as Box;
    expect(box.children).toHaveLength(1);
    expect(box.children[0]).toBeInstanceOf(Markdown);
  });

  test("should extract text from content array", () => {
    const pi = createMockPi();
    registerInfoMessageRenderer(pi as any);
    const renderer = getRenderer(pi);
    const message = {
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ],
      customType: "info",
    };
    const box = renderer(message, { expanded: false }, createMockTheme()) as Box;
    expect(box.children).toHaveLength(1);
    expect(box.children[0]).toBeInstanceOf(Markdown);
  });

  test("should filter out non-text content blocks", () => {
    const pi = createMockPi();
    registerInfoMessageRenderer(pi as any);
    const renderer = getRenderer(pi);
    const message = {
      content: [
        { type: "image", source: { type: "base64", data: "abc" } },
        { type: "text", text: "only text" },
      ],
      customType: "info",
    };
    const box = renderer(message, { expanded: false }, createMockTheme()) as Box;
    expect(box.children).toHaveLength(1);
    expect(box.children[0]).toBeInstanceOf(Markdown);
  });

  test("should apply customMessageBg background to box on render", () => {
    const pi = createMockPi();
    registerInfoMessageRenderer(pi as any);
    const renderer = getRenderer(pi);
    const theme = createMockTheme();
    const box = renderer({ content: "hello", customType: "info" }, { expanded: false }, theme) as Box;
    box.render(80);
    expect(theme.bg).toHaveBeenCalledWith("customMessageBg", expect.any(String));
  });

  test("should apply customMessageText color to markdown", () => {
    const pi = createMockPi();
    registerInfoMessageRenderer(pi as any);
    const renderer = getRenderer(pi);
    const theme = createMockTheme();
    const box = renderer({ content: "hello", customType: "info" }, { expanded: false }, theme) as Box;
    // Render to trigger the color function
    box.render(80);
    expect(theme.fg).toHaveBeenCalledWith("customMessageText", expect.any(String));
  });
});
