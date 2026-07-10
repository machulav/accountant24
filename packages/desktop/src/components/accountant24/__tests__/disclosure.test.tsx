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

  it("should render an aria-hidden shimmer duplicate while active", () => {
    render(<ShimmerLabel active>Working</ShimmerLabel>);
    const copies = screen.getAllByText("Working");
    expect(copies).toHaveLength(2);
    const shimmer = copies.find((el) => el.getAttribute("aria-hidden") === "true");
    expect(shimmer).toBeTruthy();
    expect(shimmer?.className).toContain("shimmer");
  });

  it("should not expose the shimmer duplicate to assistive technology", () => {
    render(<ShimmerLabel active>Working</ShimmerLabel>);
    const visible = screen.getAllByText("Working").filter((el) => el.getAttribute("aria-hidden") !== "true");
    expect(visible).toHaveLength(1);
  });
});
