// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { ShortcutsSettings } from "../shortcuts-settings";

// A static reference page: registry-driven key combos plus the composer's
// typed triggers. Pure render, no I/O to fake. The jsdom userAgent has no
// "Mac", so modifiers spell out (Ctrl/Alt/Shift) rather than ⌘/⌥/⇧ glyphs.

beforeAll(() => {
  installJsdomPolyfills();
});

afterEach(() => {
  cleanup();
});

describe("ShortcutsSettings", () => {
  it("should list every registered keyboard shortcut with its keycaps", () => {
    render(<ShortcutsSettings />);
    expect(screen.getByText("New chat")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("N")).toBeInTheDocument();
    expect(screen.getByText(",")).toBeInTheDocument();
  });

  it("should list the composer triggers with their characters", () => {
    render(<ShortcutsSettings />);
    expect(screen.getByText("While writing a message")).toBeInTheDocument();
    expect(screen.getByText("Mention an account, payee, or tag")).toBeInTheDocument();
    expect(screen.getByText("@")).toBeInTheDocument();
    expect(screen.getByText("Use a skill (at the start of a message)")).toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
  });
});
