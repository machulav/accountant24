import { describe, expect, test } from "bun:test";
import { initTheme } from "@mariozechner/pi-coding-agent";
import { createRenderCall, createRenderResult } from "../tool-renderer";

initTheme();

const mockTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

function makeContext(overrides: Record<string, any> = {}) {
  return {
    lastComponent: undefined,
    executionStarted: false,
    isPartial: false,
    isError: false,
    ...overrides,
  } as any;
}

describe("createRenderCall()", () => {
  const renderCall = createRenderCall({ label: "Test action" });

  test("should show label before execution starts", () => {
    const output = renderCall({}, mockTheme, makeContext()).render(120).join("\n");
    expect(output).toContain("Test action");
  });

  test("should show same label while execution is in progress", () => {
    const output = renderCall({}, mockTheme, makeContext({ executionStarted: true, isPartial: true }))
      .render(120)
      .join("\n");
    expect(output).toContain("Test action");
  });

  test("should show label with expand hint when done", () => {
    const output = renderCall({}, mockTheme, makeContext({ executionStarted: true }))
      .render(120)
      .join("\n");
    expect(output).toContain("Test action");
    expect(output).toContain("ctrl+o to expand");
  });

  test("should reuse lastComponent", () => {
    const existing = renderCall({}, mockTheme, makeContext());
    const reused = renderCall({}, mockTheme, makeContext({ lastComponent: existing }));
    expect(reused).toBe(existing);
  });

  describe("error state", () => {
    test("should show label with expand hint when errored", () => {
      const output = renderCall({}, mockTheme, makeContext({ executionStarted: true, isError: true }))
        .render(120)
        .join("\n");
      expect(output).toContain("Test action");
      expect(output).toContain("ctrl+o to expand");
    });
  });

  describe("expandable: false", () => {
    const nonExpandable = createRenderCall({ label: "Done", expandable: false });

    test("should not show expand hint on success", () => {
      const output = nonExpandable({}, mockTheme, makeContext({ executionStarted: true }))
        .render(120)
        .join("\n");
      expect(output).toContain("Done");
      expect(output).not.toContain("ctrl+o");
    });
  });
});

describe("createRenderResult()", () => {
  const renderResult = createRenderResult<{ cmd: string }>((result) => [
    { heading: "Command", content: result.details?.cmd ?? "" },
    { heading: "Output", content: result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "" },
  ]);

  function makeResult(text: string, cmd = "") {
    return { content: [{ type: "text" as const, text }], details: { cmd } };
  }

  test("should return empty when collapsed", () => {
    const output = renderResult(makeResult("x"), { expanded: false, isPartial: false }, mockTheme).render(120).join("");
    expect(output).toBe("");
  });

  test("should return empty when partial", () => {
    const output = renderResult(makeResult(""), { expanded: false, isPartial: true }, mockTheme).render(120).join("");
    expect(output).toBe("");
  });

  test("should show sections with headings when expanded", () => {
    const output = renderResult(makeResult("100 USD", "hledger bal"), { expanded: true, isPartial: false }, mockTheme)
      .render(120)
      .join("\n");
    expect(output).toContain("Command");
    expect(output).toContain("hledger bal");
    expect(output).toContain("Output");
    expect(output).toContain("100 USD");
  });

  test("should return empty when getSections returns no sections", () => {
    const emptyResult = createRenderResult<null>(() => []);
    const output = emptyResult({ content: [], details: null }, { expanded: true, isPartial: false }, mockTheme)
      .render(120)
      .join("");
    expect(output).toBe("");
  });

  test("should trim trailing whitespace from section content", () => {
    const lines = renderResult(
      makeResult("output\n\n\n", "cmd"),
      { expanded: true, isPartial: false },
      mockTheme,
    ).render(120);
    const lastNonEmpty = [...lines].reverse().find((l) => l.trim() !== "");
    expect(lastNonEmpty).toContain("output");
  });

  test("should show error content from result.content when context.isError", () => {
    const errorResult = { content: [{ type: "text" as const, text: "Error: something went wrong" }], details: null };
    const errorRenderer = createRenderResult<null>(() => []);
    const output = errorRenderer(errorResult, { expanded: true, isPartial: false }, mockTheme, { isError: true })
      .render(120)
      .join("\n");
    expect(output).toContain("Error");
    expect(output).toContain("something went wrong");
  });

  test("should use error color for heading and text when context.isError", () => {
    const colorTheme = {
      fg: (color: string, text: string) => `[${color}]${text}`,
      bold: (text: string) => text,
    } as any;
    const errorResult = { content: [{ type: "text" as const, text: "fail" }], details: null };
    const errorRenderer = createRenderResult<null>(() => []);
    const output = errorRenderer(errorResult, { expanded: true, isPartial: false }, colorTheme, { isError: true })
      .render(120)
      .join("\n");
    expect(output).toContain("[error]Error");
    expect(output).toContain("[error]fail");
  });

  test("should return same cached lines when width unchanged", () => {
    const component = renderResult(makeResult("test", "cmd"), { expanded: true, isPartial: false }, mockTheme);
    const first = component.render(100);
    const second = component.render(100);
    expect(first).toBe(second);
  });

  test("should recompute lines when width changes", () => {
    const component = renderResult(makeResult("test", "cmd"), { expanded: true, isPartial: false }, mockTheme);
    const first = component.render(100);
    const second = component.render(200);
    expect(first).not.toBe(second);
  });

  test("should recompute lines after invalidate()", () => {
    const component = renderResult(makeResult("test", "cmd"), { expanded: true, isPartial: false }, mockTheme);
    const first = component.render(100);
    component.invalidate();
    const second = component.render(100);
    // Same width, but cache was invalidated — new array instance
    expect(first).not.toBe(second);
  });

  test("should render diff sections using renderDiff", () => {
    const diffContent = "+1 added line";
    const diffRenderer = createRenderResult<{ diff: string }>((result) => [
      { heading: "Diff", content: result.details?.diff ?? "", type: "diff" },
    ]);
    const output = diffRenderer(
      { content: [], details: { diff: diffContent } },
      { expanded: true, isPartial: false },
      mockTheme,
    )
      .render(120)
      .join("\n");
    expect(output).toContain("Diff");
    expect(output).toContain("added line");
  });

  test("should preserve multiline content within a section", () => {
    const output = renderResult(
      makeResult("line1\nline2\nline3", "cmd"),
      { expanded: true, isPartial: false },
      mockTheme,
    )
      .render(120)
      .join("\n");
    expect(output).toContain("line1");
    expect(output).toContain("line2");
    expect(output).toContain("line3");
  });
});
