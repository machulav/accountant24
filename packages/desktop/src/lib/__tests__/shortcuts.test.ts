import { describe, expect, it } from "vitest";
import { matchesShortcut, matchShortcut, SHORTCUTS, type Shortcut, type ShortcutEvent } from "../shortcuts";

/** Build a ShortcutEvent, defaulting every modifier to off. */
function ev(key: string, mods: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  };
}

describe("matchesShortcut", () => {
  const modComma: Shortcut = { key: ",", mod: true };

  it("matches with Cmd (metaKey)", () => {
    expect(matchesShortcut(ev(",", { metaKey: true }), modComma)).toBe(true);
  });

  it("matches with Ctrl as the platform mod", () => {
    expect(matchesShortcut(ev(",", { ctrlKey: true }), modComma)).toBe(true);
  });

  it("does not match without the mod key", () => {
    expect(matchesShortcut(ev(","), modComma)).toBe(false);
  });

  it("does not match a different key", () => {
    expect(matchesShortcut(ev(".", { metaKey: true }), modComma)).toBe(false);
  });

  it("is case-insensitive on the key", () => {
    const modK: Shortcut = { key: "k", mod: true };
    expect(matchesShortcut(ev("K", { metaKey: true }), modK)).toBe(true);
  });

  it("rejects extra modifiers that the shortcut does not require", () => {
    expect(matchesShortcut(ev(",", { metaKey: true, shiftKey: true }), modComma)).toBe(false);
    expect(matchesShortcut(ev(",", { metaKey: true, altKey: true }), modComma)).toBe(false);
  });

  it("requires shift/alt when the shortcut specifies them", () => {
    const combo: Shortcut = { key: "p", mod: true, shift: true };
    expect(matchesShortcut(ev("p", { metaKey: true, shiftKey: true }), combo)).toBe(true);
    expect(matchesShortcut(ev("p", { metaKey: true }), combo)).toBe(false);
  });

  it("matches a plain key with no modifiers", () => {
    expect(matchesShortcut(ev("Escape"), { key: "Escape" })).toBe(true);
    expect(matchesShortcut(ev("Escape", { metaKey: true }), { key: "Escape" })).toBe(false);
  });
});

describe("matchShortcut", () => {
  it("returns the matching shortcut name", () => {
    expect(matchShortcut(ev(",", { metaKey: true }), ["openSettings"])).toBe("openSettings");
  });

  it("returns undefined when nothing matches", () => {
    expect(matchShortcut(ev(",", { metaKey: true }), [])).toBeUndefined();
    expect(matchShortcut(ev("x"), ["openSettings"])).toBeUndefined();
  });

  it("ignores names whose combo does not match the event", () => {
    expect(matchShortcut(ev(","), ["openSettings"])).toBeUndefined();
  });

  it("picks the right name when several are registered", () => {
    const names = ["newChat", "openSettings"] as const;
    expect(matchShortcut(ev("n", { metaKey: true }), names)).toBe("newChat");
    expect(matchShortcut(ev(",", { metaKey: true }), names)).toBe("openSettings");
  });
});

describe("SHORTCUTS registry", () => {
  it("binds openSettings to mod+comma", () => {
    expect(SHORTCUTS.openSettings).toEqual({ key: ",", mod: true });
  });

  it("binds newChat to mod+n", () => {
    expect(SHORTCUTS.newChat).toEqual({ key: "n", mod: true });
  });
});
