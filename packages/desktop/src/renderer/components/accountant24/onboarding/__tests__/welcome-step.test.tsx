// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { USE_CASES } from "../use-case-showcase";
import { WelcomeStep } from "../welcome-step";

afterEach(() => cleanup());

describe("WelcomeStep", () => {
  it("should show the app name as the heading", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getByRole("heading", { name: "Accountant24" })).toBeInTheDocument();
  });

  it("should show the one-line description", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getByText("Local-first AI agent for personal finance.")).toBeInTheDocument();
  });

  it("should show the use-case showcase in place of a paragraph", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getByText(USE_CASES[0]?.prompt ?? "")).toBeInTheDocument();
  });

  it("should call onNext when Get started is clicked", () => {
    const onNext = vi.fn();
    render(<WelcomeStep onNext={onNext} />);
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("should offer Get started as the only action", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
