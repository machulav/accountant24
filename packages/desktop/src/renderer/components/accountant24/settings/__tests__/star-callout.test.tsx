// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StarCallout } from "../star-callout";

afterEach(() => {
  cleanup();
});

describe("StarCallout", () => {
  it("should link to the GitHub repository", () => {
    render(<StarCallout />);
    const link = screen.getByRole("link", { name: /Enjoying the app\?/ });
    expect(link).toHaveAttribute("href", "https://github.com/machulav/accountant24");
  });

  it("should invite the user to star the repo", () => {
    render(<StarCallout />);
    expect(screen.getByText("Star us on GitHub")).toBeInTheDocument();
  });
});
