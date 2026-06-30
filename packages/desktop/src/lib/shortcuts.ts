// Central registry of app keyboard shortcuts. Define the key combos here and
// wire handlers via `useKeyboardShortcuts`. `mod` is Cmd on macOS, Ctrl
// elsewhere, so each binding follows the platform convention automatically.

export type Shortcut = {
  /** Matched case-insensitively against `KeyboardEvent.key` (e.g. ",", "k"). */
  key: string;
  /** Require the platform command key: Cmd on macOS, Ctrl on Windows/Linux. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export const SHORTCUTS = {
  openSettings: { key: ",", mod: true },
} satisfies Record<string, Shortcut>;

export type ShortcutName = keyof typeof SHORTCUTS;

/** The keyboard event fields a shortcut match depends on. */
export type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

/** True when the keyboard event matches the shortcut's key + exact modifiers. */
export function matchesShortcut(e: ShortcutEvent, s: Shortcut): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  if (!!s.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (!!s.shift !== e.shiftKey) return false;
  if (!!s.alt !== e.altKey) return false;
  return true;
}

/** First shortcut name (among `names`) whose combo matches the event, if any. */
export function matchShortcut(
  e: ShortcutEvent,
  names: readonly ShortcutName[],
): ShortcutName | undefined {
  return names.find((name) => matchesShortcut(e, SHORTCUTS[name]));
}
