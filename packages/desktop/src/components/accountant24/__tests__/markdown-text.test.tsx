// @vitest-environment jsdom

import { TextMessagePartProvider } from "@assistant-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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

  it("should render an ATX level-3 heading as a level-3 heading element", async () => {
    draw("### Assets");
    const heading = await screen.findByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("Assets");
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
});
