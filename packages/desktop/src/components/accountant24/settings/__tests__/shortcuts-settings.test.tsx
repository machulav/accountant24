// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { ShortcutsSettings } from "../shortcuts-settings";

// The jsdom userAgent has no "Mac", so the reference spells modifiers out
// (Ctrl/Alt/Shift) rather than showing ⌘/⌥/⇧ glyphs.

beforeAll(() => {
  installJsdomPolyfills();
});

afterEach(() => {
  cleanup();
});

describe("ShortcutsSettings", () => {
  it("should list the New chat action", () => {
    render(<ShortcutsSettings />);
    expect(screen.getByText("New chat")).toBeInTheDocument();
  });

  it("should list the Settings action", () => {
    render(<ShortcutsSettings />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("should render the New chat combo as the Ctrl + N keycaps", () => {
    render(<ShortcutsSettings />);
    // Both registered shortcuts use the platform command key.
    expect(screen.getAllByText("Ctrl")).toHaveLength(2);
    expect(screen.getByText("N")).toBeInTheDocument();
  });

  it("should render the Settings combo with a comma keycap", () => {
    render(<ShortcutsSettings />);
    expect(screen.getByText(",")).toBeInTheDocument();
  });
});
