// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CategoryBars } from "../category-bars";

afterEach(() => {
  cleanup();
});

describe("CategoryBars", () => {
  it("should render a row with label and amount for each dominant-currency entry", () => {
    render(
      <CategoryBars
        categories={[
          { name: "food", amount: 500, currency: "EUR" },
          { name: "housing", amount: 1200, currency: "EUR" },
        ]}
        currency="EUR"
      />,
    );
    expect(screen.getByText("Food")).toBeTruthy();
    expect(screen.getByText("500.00 EUR")).toBeTruthy();
    expect(screen.getByText("Housing")).toBeTruthy();
    expect(screen.getByText("1,200.00 EUR")).toBeTruthy();
  });

  it("should hide entries in other currencies", () => {
    render(
      <CategoryBars
        categories={[
          { name: "food", amount: 500, currency: "EUR" },
          { name: "travel", amount: 900, currency: "UAH" },
        ]}
        currency="EUR"
      />,
    );
    expect(screen.queryByText("Travel")).toBeNull();
  });

  it("should hide refund-only entries (non-positive amounts)", () => {
    render(
      <CategoryBars
        categories={[
          { name: "food", amount: 500, currency: "EUR" },
          { name: "shopping", amount: -80, currency: "EUR" },
        ]}
        currency="EUR"
      />,
    );
    expect(screen.queryByText("Shopping")).toBeNull();
  });

  it("should show an empty message when no rows remain", () => {
    render(<CategoryBars categories={[]} currency="EUR" />);
    expect(screen.getByText("No spending this month")).toBeTruthy();
  });

  it("should prettify hyphenated account names", () => {
    render(<CategoryBars categories={[{ name: "personal-care", amount: 40, currency: "EUR" }]} currency="EUR" />);
    expect(screen.getByText("Personal care")).toBeTruthy();
  });
});
