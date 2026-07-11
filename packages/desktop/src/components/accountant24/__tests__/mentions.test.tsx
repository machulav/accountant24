// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { LedgerDirectiveText, MentionChip, MentionPill } from "../mentions";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());

/** The chip element carrying a given label, or null. MentionPill stamps the
 *  mention type onto `data-directive-type` — the component's own DOM contract. */
const chipFor = (label: string): HTMLElement | null => screen.getByText(label).closest("[data-directive-type]");

/** Render LedgerDirectiveText with just the `text` field (the rest of the
 *  TextMessagePart props are unused by this renderer). */
const renderDirectiveText = (text: string) =>
  render(<LedgerDirectiveText {...({ text } as ComponentProps<typeof LedgerDirectiveText>)} />);

describe("MentionPill", () => {
  it("should render the account label as a chip carrying the account type", () => {
    render(<MentionPill type="account" label="Assets:Cash" />);
    expect(screen.getByText("Assets:Cash")).toBeInTheDocument();
    expect(chipFor("Assets:Cash")).toHaveAttribute("data-directive-type", "account");
  });

  it("should render the payee label as a chip carrying the payee type", () => {
    render(<MentionPill type="payee" label="Acme Corp" />);
    expect(chipFor("Acme Corp")).toHaveAttribute("data-directive-type", "payee");
  });

  it("should render the tag label as a chip carrying the tag type", () => {
    render(<MentionPill type="tag" label="trip" />);
    expect(chipFor("trip")).toHaveAttribute("data-directive-type", "tag");
  });

  it("should still render the label for an unknown mention type", () => {
    render(<MentionPill type="mystery" label="Whatever" />);
    expect(screen.getByText("Whatever")).toBeInTheDocument();
    expect(chipFor("Whatever")).toHaveAttribute("data-directive-type", "mystery");
  });
});

describe("MentionChip", () => {
  it("should render a chip from a Lexical directive's type and label", () => {
    render(
      <MentionChip {...({ directiveType: "account", label: "Expenses:Food" } as ComponentProps<typeof MentionChip>)} />,
    );
    expect(chipFor("Expenses:Food")).toHaveAttribute("data-directive-type", "account");
  });
});

describe("LedgerDirectiveText", () => {
  it("should render plain text unchanged when there are no mention directives", () => {
    renderDirectiveText("Just a normal sentence.");
    expect(screen.getByText("Just a normal sentence.")).toBeInTheDocument();
    // No chip should be produced for plain prose.
    expect(document.querySelector("[data-directive-type]")).toBeNull();
  });

  it("should not treat an ordinary prose colon as a mention", () => {
    renderDirectiveText("Meeting at 10:30 sharp");
    expect(screen.getByText("Meeting at 10:30 sharp")).toBeInTheDocument();
    expect(document.querySelector("[data-directive-type]")).toBeNull();
  });

  it("should render a single directive that spans the whole text as one chip", () => {
    renderDirectiveText(":account[Assets:Cash]");
    expect(chipFor("Assets:Cash")).toHaveAttribute("data-directive-type", "account");
    // The literal directive syntax must not leak through.
    expect(screen.queryByText(":account[Assets:Cash]")).toBeNull();
  });

  it("should split surrounding text into plain segments around a directive", () => {
    renderDirectiveText("Paid :payee[Acme Corp] on Monday");
    expect(chipFor("Acme Corp")).toHaveAttribute("data-directive-type", "payee");
    expect(screen.getByText("Paid", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("on Monday", { exact: false })).toBeInTheDocument();
  });

  it("should render each directive type distinctly when several appear together", () => {
    renderDirectiveText(":account[Assets:Cash] :payee[Acme] :tag[trip]");
    expect(chipFor("Assets:Cash")).toHaveAttribute("data-directive-type", "account");
    expect(chipFor("Acme")).toHaveAttribute("data-directive-type", "payee");
    expect(chipFor("trip")).toHaveAttribute("data-directive-type", "tag");
  });

  it("should not render a chip for an unknown directive type", () => {
    renderDirectiveText("See :foo[bar] here");
    // :foo is not one of account/payee/tag, so it stays literal text.
    expect(screen.getByText("See :foo[bar] here")).toBeInTheDocument();
    expect(document.querySelector("[data-directive-type]")).toBeNull();
  });
});
