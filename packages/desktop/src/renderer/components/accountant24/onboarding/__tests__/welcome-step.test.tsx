// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeStep } from "../welcome-step";

afterEach(() => cleanup());

describe("WelcomeStep", () => {
  it("should introduce the app by name", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getByRole("heading", { name: "Welcome to Accountant24" })).toBeInTheDocument();
    expect(screen.getByText("A local-first AI agent for personal finance.")).toBeInTheDocument();
  });

  it("should show what the app can do, one line each", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getByText("Log spending in plain language")).toBeInTheDocument();
    expect(screen.getByText("Import statements and receipts")).toBeInTheDocument();
    expect(screen.getByText("Ask anything about your money")).toBeInTheDocument();
  });

  it("should promise the data stays on the machine", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getByText(/stays on this Mac as plain text/)).toBeInTheDocument();
  });

  it("should offer Get started as the only action", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("should call onNext when Get started is clicked", () => {
    const onNext = vi.fn();
    render(<WelcomeStep onNext={onNext} />);
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
