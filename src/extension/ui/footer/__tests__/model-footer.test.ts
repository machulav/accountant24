import { describe, expect, mock, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { ModelFooter } from "../model-footer";

const mockTheme = { fg: (_color: string, text: string) => text } as any;
const createMockTui = () => ({ requestRender: mock(() => {}) }) as any;

describe("ModelFooter", () => {
  test("should return empty array when no model is set", () => {
    const footer = new ModelFooter(createMockTui(), mockTheme);
    expect(footer.render(80)).toEqual([]);
  });

  test("should right-align model name", () => {
    const footer = new ModelFooter(createMockTui(), mockTheme);
    footer.setModel("Model");
    const line = footer.render(20)[0];
    expect(line).toMatch(/^\s+Model$/);
    expect(visibleWidth(line)).toBe(20);
  });

  test("should render model name with dim styling", () => {
    const theme = { fg: (color: string, text: string) => `[${color}]${text}` } as any;
    const footer = new ModelFooter(createMockTui(), theme);
    footer.setModel("Model");
    const line = footer.render(20)[0];
    // Right-aligned: padding + styled text
    expect(line).toContain("[dim]Model");
  });

  test("should update displayed model when setModel is called again", () => {
    const footer = new ModelFooter(createMockTui(), mockTheme);
    footer.setModel("Claude 3.5 Sonnet");
    footer.setModel("GPT-4o");
    expect(footer.render(80)[0].trimStart()).toBe("GPT-4o");
  });

  test("should return empty array when model is set to empty string", () => {
    const footer = new ModelFooter(createMockTui(), mockTheme);
    footer.setModel("");
    expect(footer.render(80)).toEqual([]);
  });

  test("should call tui.requestRender on setModel", () => {
    const tui = createMockTui();
    const footer = new ModelFooter(tui, mockTheme);
    footer.setModel("Claude 3.5 Sonnet");
    expect(tui.requestRender).toHaveBeenCalledWith(true);
  });

  test("should truncate to width", () => {
    const footer = new ModelFooter(createMockTui(), mockTheme);
    footer.setModel("A very long model name that exceeds width");
    const lines = footer.render(20);
    expect(visibleWidth(lines[0])).toBeLessThanOrEqual(20);
  });

  test("should hide when autocomplete is showing", () => {
    const footer = new ModelFooter(createMockTui(), mockTheme);
    footer.setModel("Model");
    footer.setEditor({ isShowingAutocomplete: () => true });
    expect(footer.render(80)).toEqual([]);
  });

  test("should show when autocomplete is not showing", () => {
    const footer = new ModelFooter(createMockTui(), mockTheme);
    footer.setModel("Model");
    footer.setEditor({ isShowingAutocomplete: () => false });
    expect(footer.render(80)[0].trimStart()).toBe("Model");
  });

  test("invalidate should not throw", () => {
    const footer = new ModelFooter(createMockTui(), mockTheme);
    expect(() => footer.invalidate()).not.toThrow();
  });

  test("dispose should not throw", () => {
    const footer = new ModelFooter(createMockTui(), mockTheme);
    expect(() => footer.dispose()).not.toThrow();
  });
});
