// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { SkillPill } from "../skill-pill";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());

const chipFor = (label: string): HTMLElement | null => screen.getByText(label).closest("[data-directive-type]");

describe("SkillPill", () => {
  it("should render the skill label", () => {
    render(<SkillPill label="Subscription audit" />);
    expect(screen.getByText("Subscription audit")).toBeInTheDocument();
  });

  it("should stamp the skill directive type onto the chip", () => {
    render(<SkillPill label="Budgeting" />);
    expect(chipFor("Budgeting")).toHaveAttribute("data-directive-type", "skill");
  });

  it("should render an icon alongside the label", () => {
    render(<SkillPill label="Recurring spending" />);
    expect(chipFor("Recurring spending")?.querySelector("svg")).not.toBeNull();
  });
});
