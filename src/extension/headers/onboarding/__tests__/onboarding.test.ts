import { describe, expect, test } from "bun:test";
import { Onboarding } from "../onboarding";

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are control chars by definition
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function strip(str: string): string {
  return str.replace(ANSI_RE, "");
}

describe("Onboarding component", () => {
  test("should render Accountant24 header", () => {
    const o = new Onboarding();
    const lines = o.render(80).map(strip);
    expect(lines.some((l) => l.includes("Accountant24"))).toBe(true);
    expect(lines.some((l) => l.includes("──"))).toBe(true);
  });

  test("should render intro text", () => {
    const o = new Onboarding();
    const lines = o.render(80).map(strip);
    expect(lines.some((l) => l.includes("No transactions yet"))).toBe(true);
  });

  test("should render expense example prompt", () => {
    const o = new Onboarding();
    const lines = o.render(80).map(strip);
    expect(lines.some((l) => l.includes("I spent 45 EUR on groceries"))).toBe(true);
  });

  test("should render income example prompt", () => {
    const o = new Onboarding();
    const lines = o.render(80).map(strip);
    expect(lines.some((l) => l.includes("I received 3000 EUR salary"))).toBe(true);
  });

  test("should render at narrow width", () => {
    const o = new Onboarding();
    const lines = o.render(40).map(strip);
    expect(lines.some((l) => l.includes("Accountant24"))).toBe(true);
    expect(lines.some((l) => l.includes("No transactions yet"))).toBe(true);
  });
});
