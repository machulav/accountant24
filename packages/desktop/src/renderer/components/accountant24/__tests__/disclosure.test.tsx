// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShimmerLabel } from "../disclosure";

afterEach(cleanup);

describe("ShimmerLabel", () => {
  it("should render its children once when inactive", () => {
    render(<ShimmerLabel>Query Ledger</ShimmerLabel>);
    expect(screen.getAllByText("Query Ledger")).toHaveLength(1);
  });

  it("should render its children once while active (the sweep clips to the text itself)", () => {
    render(<ShimmerLabel active>Working</ShimmerLabel>);
    expect(screen.getAllByText("Working")).toHaveLength(1);
  });

  it("should apply the shimmer utility while active", () => {
    render(<ShimmerLabel active>Working</ShimmerLabel>);
    expect(screen.getByText("Working").className).toContain("shimmer");
  });

  it("should not apply the shimmer utility when inactive", () => {
    render(<ShimmerLabel>Worked for 2s</ShimmerLabel>);
    expect(screen.getByText("Worked for 2s").className).not.toContain("shimmer");
  });

  it("should disable the sweep under reduced motion while active", () => {
    render(<ShimmerLabel active>Working</ShimmerLabel>);
    expect(screen.getByText("Working").className).toContain("motion-reduce:shimmer-none");
  });

  it("should keep caller classes and pass props through to the label element", () => {
    render(
      <ShimmerLabel active data-slot="tool-fallback-trigger-label" className="font-medium">
        Query Ledger
      </ShimmerLabel>,
    );
    const label = screen.getByText("Query Ledger");
    expect(label.className).toContain("font-medium");
    expect(label.getAttribute("data-slot")).toBe("tool-fallback-trigger-label");
  });
});
