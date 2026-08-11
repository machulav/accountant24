// @vitest-environment jsdom

// Spec for the shared full-page empty view: the icon, title, description,
// and the optional action button all come straight from the props — the
// pages (Transactions, Net Worth) differ only in what they pass.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FC } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("should render no button when no action is given", () => {
    render(<PageEmpty icon={TestIcon} title="Nothing here yet" description="Ask the agent and it will show up" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("should render the action as a button that fires its onClick", () => {
    const onClick = vi.fn();
    render(
      <PageEmpty
        icon={TestIcon}
        title="Nothing here yet"
        description="Ask the agent and it will show up"
        action={{ label: "Take action", onClick }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Take action" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("should render the action's icon inside the button when given", () => {
    const ActionIcon: FC<{ className?: string }> = () => <svg role="img" aria-label="Action icon" />;
    render(
      <PageEmpty
        icon={TestIcon}
        title="Nothing here yet"
        description="Ask the agent and it will show up"
        action={{ label: "Take action", icon: ActionIcon, onClick: vi.fn() }}
      />,
    );
    const button = screen.getByRole("button", { name: /Take action/ });
    expect(screen.getByRole("img", { name: "Action icon" })).toBeInTheDocument();
    expect(button).toContainElement(screen.getByRole("img", { name: "Action icon" }));
  });
});
