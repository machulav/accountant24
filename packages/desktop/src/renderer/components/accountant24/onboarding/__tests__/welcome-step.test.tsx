// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeStep } from "../welcome-step";

afterEach(() => cleanup());

describe("WelcomeStep", () => {
  it("should lead with the wordmark, then the landing page's headline and tagline", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getByText("Accountant24")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Open source AI agent for personal finance" })).toBeInTheDocument();
    expect(screen.getByText("Runs on your machine, you own the data")).toBeInTheDocument();
  });

  it("should show what the app can do, one line each", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getByText("Log spending in plain language")).toBeInTheDocument();
    expect(screen.getByText("Import bank statements and receipts")).toBeInTheDocument();
    expect(screen.getByText("Ask questions about your money")).toBeInTheDocument();
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
