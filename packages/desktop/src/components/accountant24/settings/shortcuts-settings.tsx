// Shortcuts — a read-only reference of the app's keyboard shortcuts, rendered
// straight from the SHORTCUTS registry so it never drifts from what's wired up.

import { Kbd } from "@/components/shadcn/kbd";
import { SHORTCUTS, type ShortcutName, shortcutTokens } from "@/lib/shortcuts";
import { Section } from "./parts";

// macOS shows ⌘/⌥/⇧ glyphs; other platforms spell out Ctrl/Alt/Shift.
const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

export function ShortcutsSettings() {
  const names = Object.keys(SHORTCUTS) as ShortcutName[];

  return (
    <Section title="Keyboard shortcuts" description="Speed up common actions.">
      <div className="flex flex-col gap-1">
        {names.map((name) => (
          <div key={name} className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
            <span className="truncate text-sm">{SHORTCUTS[name].label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {shortcutTokens(SHORTCUTS[name], isMac).map((token) => (
                <Kbd key={token}>{token}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
