// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { DirectiveChip, DirectivePill, DirectiveText } from "../directive-chips";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());

/** The chip carrying a given label (any directive type stamps data-directive-type). */
const chipFor = (label: string): HTMLElement | null => screen.getByText(label).closest("[data-directive-type]");

const renderText = (text: string) => render(<DirectiveText {...({ text } as ComponentProps<typeof DirectiveText>)} />);

describe("DirectivePill", () => {
  it("should route a ledger mention type to a mention chip", () => {
    render(<DirectivePill type="account" label="Assets:Cash" />);
    expect(chipFor("Assets:Cash")).toHaveAttribute("data-directive-type", "account");
  });

  it("should route a skill directive to a skill chip", () => {
    render(<DirectivePill type="skill" label="Budgeting" />);
    expect(chipFor("Budgeting")).toHaveAttribute("data-directive-type", "skill");
  });
});

describe("DirectiveChip", () => {
  it("should render a chip from a Lexical directive's type and label", () => {
    render(<DirectiveChip {...({ directiveType: "payee", label: "Acme" } as ComponentProps<typeof DirectiveChip>)} />);
    expect(chipFor("Acme")).toHaveAttribute("data-directive-type", "payee");
  });
});

describe("DirectiveText", () => {
  it("should render plain text unchanged when there are no directives", () => {
    renderText("Just a normal sentence.");
    expect(screen.getByText("Just a normal sentence.")).toBeInTheDocument();
    expect(document.querySelector("[data-directive-type]")).toBeNull();
  });

  it("should not treat an ordinary prose colon as a directive", () => {
    renderText("Meeting at 10:30 sharp");
    expect(screen.getByText("Meeting at 10:30 sharp")).toBeInTheDocument();
    expect(document.querySelector("[data-directive-type]")).toBeNull();
  });

  it("should render a single directive that spans the whole text as one chip", () => {
    renderText(":account[Assets:Cash]");
    expect(chipFor("Assets:Cash")).toHaveAttribute("data-directive-type", "account");
    expect(screen.queryByText(":account[Assets:Cash]")).toBeNull();
  });

  it("should split surrounding text into plain segments around a directive", () => {
    renderText("Paid :payee[Acme Corp] on Monday");
    expect(chipFor("Acme Corp")).toHaveAttribute("data-directive-type", "payee");
    expect(screen.getByText("Paid", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("on Monday", { exact: false })).toBeInTheDocument();
  });

  it("should render each directive type distinctly when several appear together", () => {
    renderText(":account[Assets:Cash] :payee[Acme] :tag[trip] :skill[Budgeting]");
    expect(chipFor("Assets:Cash")).toHaveAttribute("data-directive-type", "account");
    expect(chipFor("Acme")).toHaveAttribute("data-directive-type", "payee");
    expect(chipFor("trip")).toHaveAttribute("data-directive-type", "tag");
    expect(chipFor("Budgeting")).toHaveAttribute("data-directive-type", "skill");
  });

  it("should leave an unknown directive type as literal text", () => {
    renderText("See :foo[bar] here");
    expect(screen.getByText("See :foo[bar] here")).toBeInTheDocument();
    expect(document.querySelector("[data-directive-type]")).toBeNull();
  });
});
