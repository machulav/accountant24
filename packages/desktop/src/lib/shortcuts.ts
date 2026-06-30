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

/** A registered shortcut: a key combo plus the action label shown in Settings. */
export type ShortcutDef = Shortcut & { label: string };

export const SHORTCUTS = {
  newChat: { label: "New chat", key: "n", mod: true },
  openSettings: { label: "Settings", key: ",", mod: true },
} satisfies Record<string, ShortcutDef>;

export type ShortcutName = keyof typeof SHORTCUTS;

/** The keyboard event fields a shortcut match depends on. */
export type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/** True when the keyboard event matches the shortcut's key + exact modifiers. */
export function matchesShortcut(e: ShortcutEvent, s: Shortcut): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  if (!!s.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (!!s.shift !== e.shiftKey) return false;
  if (!!s.alt !== e.altKey) return false;
  return true;
}

/** First shortcut name (among `names`) whose combo matches the event, if any. */
export function matchShortcut(e: ShortcutEvent, names: readonly ShortcutName[]): ShortcutName | undefined {
  return names.find((name) => matchesShortcut(e, SHORTCUTS[name]));
}

/** A single key shown to the user: letters upper-cased, a few named keys mapped
 *  to their glyphs. */
function displayKey(key: string): string {
  const named: Record<string, string> = {
    " ": "Space",
    Enter: "↵",
    Escape: "Esc",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };
  if (key.length === 1) return key.toUpperCase();
  return named[key] ?? key;
}

/** The shortcut as ordered display tokens for rendering as separate keycaps —
 *  e.g. `["⌘", "N"]` on macOS or `["Ctrl", "N"]` elsewhere. Modifier order
 *  follows each platform's convention (Command last on macOS, Ctrl first
 *  elsewhere). */
export function shortcutTokens(s: Shortcut, isMac: boolean): string[] {
  const mod = isMac ? "⌘" : "Ctrl";
  const alt = isMac ? "⌥" : "Alt";
  const shift = isMac ? "⇧" : "Shift";
  const tokens = isMac
    ? [s.alt && alt, s.shift && shift, s.mod && mod]
    : [s.mod && mod, s.alt && alt, s.shift && shift];
  return [...tokens.filter((t): t is string => Boolean(t)), displayKey(s.key)];
}
