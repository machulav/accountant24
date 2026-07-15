// @vitest-environment jsdom

import { TextMessagePartProvider } from "@assistant-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { MarkdownText } from "../markdown-text";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());

/** Render assistant markdown the way the thread does — MarkdownText reads its
 *  text from the surrounding text-message-part context. */
const renderMarkdown = (markdown: string): ReactElement => (
  <TextMessagePartProvider text={markdown}>
    <MarkdownText />
  </TextMessagePartProvider>
);

const draw = (markdown: string) => render(renderMarkdown(markdown));

describe("MarkdownText", () => {
  it("should render an ATX level-1 heading as a level-1 heading element", async () => {
    draw("# Balance Sheet");
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Balance Sheet");
  });

  it("should render an ATX level-2 heading as a level-2 heading element", async () => {
    draw("## Liabilities");
    const heading = await screen.findByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Liabilities");
  });

  it("should render an ATX level-3 heading as a level-3 heading element", async () => {
    draw("### Assets");
    const heading = await screen.findByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("Assets");
  });

  it("should render an ATX level-4 heading as a level-4 heading element", async () => {
    draw("#### Current Assets");
    const heading = await screen.findByRole("heading", { level: 4 });
    expect(heading).toHaveTextContent("Current Assets");
  });

  it("should render an ATX level-5 heading as a level-5 heading element", async () => {
    draw("##### Cash Equivalents");
    const heading = await screen.findByRole("heading", { level: 5 });
    expect(heading).toHaveTextContent("Cash Equivalents");
  });

  it("should render an ATX level-6 heading as a level-6 heading element", async () => {
    draw("###### Petty Cash");
    const heading = await screen.findByRole("heading", { level: 6 });
    expect(heading).toHaveTextContent("Petty Cash");
  });

  it("should render a thematic break as a separator (<hr>) element", async () => {
    draw("Above\n\n---\n\nBelow");
    await screen.findByText("Above");
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("should render a footnote reference as a superscript", async () => {
    draw("Interest accrues[^1]\n\n[^1]: Compounded monthly.");
    await screen.findByText(/Interest accrues/);
    expect(document.querySelector("sup")).not.toBeNull();
  });

  it("should render a bullet list as a list with one item per bullet", async () => {
    draw("- Cash\n- Bank\n- Savings");
    await screen.findByText("Cash");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Cash", "Bank", "Savings"]);
  });

  it("should render an ordered list as one item per entry", async () => {
    draw("1. First\n2. Second");
    await screen.findByText("First");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["First", "Second"]);
  });

  it("should render a markdown link as an anchor with its href and text", async () => {
    draw("See [the docs](https://example.com/docs) now");
    const link = await screen.findByRole("link", { name: "the docs" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
  });

  it("should render inline code inside a <code> element", async () => {
    draw("Run `hledger balance` first");
    const code = await screen.findByText("hledger balance");
    expect(code.tagName).toBe("CODE");
  });

  it("should render bold text inside a <strong> element", async () => {
    draw("This is **important** text");
    const strong = await screen.findByText("important");
    expect(strong.tagName).toBe("STRONG");
  });

  it("should render a blockquote as a <blockquote> element", async () => {
    draw("> quoted wisdom");
    const quote = await screen.findByText("quoted wisdom");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("should render a fenced code block with its language label and code", async () => {
    draw("```js\nconst x = 1;\n```");
    // CodeHeader shows the language (lowercased) and the code renders verbatim.
    await screen.findByText("js");
    expect(screen.getByText(/const x = 1;/)).toBeInTheDocument();
  });

  it("should render a GFM table with column headers and cell values", async () => {
    draw(["| Account | Amount |", "| --- | --- |", "| Cash | 100 |"].join("\n"));
    const table = await screen.findByRole("table");
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Amount" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Cash" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "100" })).toBeInTheDocument();
  });

  it("should render a mention directive in markdown as a mention chip, not literal syntax", async () => {
    draw("Balance for :account[Assets:Cash] is low");
    const chip = await screen.findByText("Assets:Cash");
    expect(chip.closest("[data-directive-type]")).toHaveAttribute("data-directive-type", "account");
    expect(screen.queryByText(/:account\[/)).toBeNull();
  });

  it("should render a backtick-wrapped mention directive as a chip", async () => {
    // The model often wraps a directive in backticks; remarkMentions splits
    // those inlineCode nodes too so the chip renders instead of a code span.
    draw("Tagged `:tag[trip]` here");
    const chip = await screen.findByText("trip");
    expect(chip.closest("[data-directive-type]")).toHaveAttribute("data-directive-type", "tag");
  });

  it("should render plain paragraph prose as text", async () => {
    draw("A simple sentence with no formatting.");
    expect(await screen.findByText("A simple sentence with no formatting.")).toBeInTheDocument();
  });

  describe("code block copy button", () => {
    afterEach(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    });

    const stubClipboard = (writeText: () => Promise<void>) => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
    };

    it("should copy the block's code to the clipboard when the Copy button is clicked", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubClipboard(writeText);

      draw("```js\nconst x = 1;\n```");
      await screen.findByText("js");
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0][0]).toContain("const x = 1;");
    });

    it("should not copy again while the copied state is still active", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubClipboard(writeText);

      draw("```js\nconst x = 1;\n```");
      await screen.findByText("js");
      const copyButton = screen.getByRole("button", { name: "Copy" });
      fireEvent.click(copyButton);
      // Wait for the transient isCopied flag to flip before the second click.
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      fireEvent.click(copyButton);

      expect(writeText).toHaveBeenCalledTimes(1);
    });
  });
});
