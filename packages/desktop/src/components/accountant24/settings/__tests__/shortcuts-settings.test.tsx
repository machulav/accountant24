// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShortcutsSettings } from "../shortcuts-settings";

// A static reference page: registry-driven key combos plus the composer's
// typed triggers. Pure render, no I/O to fake.

afterEach(() => {
  cleanup();
});

describe("ShortcutsSettings", () => {
  it("should list every registered keyboard shortcut with its keycaps", () => {
    render(<ShortcutsSettings />);
    expect(screen.getByText("New chat")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("N")).toBeTruthy();
    expect(screen.getByText(",")).toBeTruthy();
  });

  it("should list the composer triggers with their characters", () => {
    render(<ShortcutsSettings />);
    expect(screen.getByText("While writing a message")).toBeTruthy();
    expect(screen.getByText("Mention an account, payee, or tag")).toBeTruthy();
    expect(screen.getByText("@")).toBeTruthy();
    expect(screen.getByText("Use a skill (at the start of a message)")).toBeTruthy();
    expect(screen.getByText("/")).toBeTruthy();
  });
});
