// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { MentionPill } from "../mentions";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());

/** The chip element carrying a given label, or null. MentionPill stamps the
 *  mention type onto `data-directive-type` — the component's own DOM contract. */
const chipFor = (label: string): HTMLElement | null => screen.getByText(label).closest("[data-directive-type]");

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
