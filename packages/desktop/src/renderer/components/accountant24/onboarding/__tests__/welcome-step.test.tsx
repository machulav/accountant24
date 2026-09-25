// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeStep } from "../welcome-step";

afterEach(() => cleanup());

describe("WelcomeStep", () => {
  it("should lead with the wordmark and a plain welcome, not the landing page's pitch", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getByText("Accountant24")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.queryByText(/Open source AI agent/)).toBeNull();
    expect(screen.queryByText(/Runs on your machine/)).toBeNull();
  });

  it("should say what setup involves and how long it takes, not what the app does", () => {
    render(<WelcomeStep onNext={() => {}} />);
    expect(screen.getByText(/Connect the AI you'll be talking to and you're in/)).toBeInTheDocument();
    expect(screen.getByText(/about a minute/)).toBeInTheDocument();
    expect(screen.queryByText(/Log spending/)).toBeNull();
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
