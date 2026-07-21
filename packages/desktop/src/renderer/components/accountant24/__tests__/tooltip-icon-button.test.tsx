// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { TooltipIconButton } from "../tooltip-icon-button";

beforeAll(() => {
  installJsdomPolyfills();
});

afterEach(() => {
  cleanup();
});

describe("TooltipIconButton", () => {
  it("should render the child icon", () => {
    render(
      <TooltipIconButton tooltip="Copy">
        <svg data-testid="icon" />
      </TooltipIconButton>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("should name the button by its tooltip so it is reachable by its accessible name", () => {
    render(
      <TooltipIconButton tooltip="Copy">
        <svg data-testid="icon" />
      </TooltipIconButton>,
    );
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("should use the given tooltip as the label, whatever it is", () => {
    render(
      <TooltipIconButton tooltip="Delete message">
        <svg data-testid="icon" />
      </TooltipIconButton>,
    );
    expect(screen.getByRole("button", { name: "Delete message" })).toBeInTheDocument();
  });

  it("should forward onClick to the button", () => {
    const onClick = vi.fn();
    render(
      <TooltipIconButton tooltip="Copy" onClick={onClick}>
        <svg data-testid="icon" />
      </TooltipIconButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("should not fire onClick before the user clicks", () => {
    const onClick = vi.fn();
    render(
      <TooltipIconButton tooltip="Copy" onClick={onClick}>
        <svg data-testid="icon" />
      </TooltipIconButton>,
    );
    expect(onClick).not.toHaveBeenCalled();
  });

  it("should forward the disabled prop, blocking clicks", () => {
    const onClick = vi.fn();
    render(
      <TooltipIconButton tooltip="Copy" disabled onClick={onClick}>
        <svg data-testid="icon" />
      </TooltipIconButton>,
    );
    const button = screen.getByRole("button", { name: "Copy" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
