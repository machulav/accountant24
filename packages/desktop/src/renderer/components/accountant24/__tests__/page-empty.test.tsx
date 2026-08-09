// @vitest-environment jsdom

// Spec for the shared full-page empty view: the icon, title, and
// description all come straight from the props — the pages (Transactions,
// Net Worth) differ only in what they pass.

import { cleanup, render, screen } from "@testing-library/react";
import type { FC } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PageEmpty } from "../page-empty";

afterEach(() => cleanup());

const TestIcon: FC<{ className?: string }> = ({ className }) => (
  <svg role="img" aria-label="Test icon" className={className} />
);

describe("<PageEmpty />", () => {
  it("should render the given icon, title, and description", () => {
    render(<PageEmpty icon={TestIcon} title="Nothing here yet" description="Ask the agent and it will show up" />);
    expect(screen.getByRole("img", { name: "Test icon" })).toBeInTheDocument();
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.getByText("Ask the agent and it will show up")).toBeInTheDocument();
  });
});
