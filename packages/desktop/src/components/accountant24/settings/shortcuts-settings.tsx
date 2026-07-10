// Shortcuts — a read-only reference of the app's keyboard shortcuts, rendered
// straight from the SHORTCUTS registry so it never drifts from what's wired up.

import { ItemActions, ItemContent, ItemTitle } from "@/components/shadcn/item";
import { Kbd, KbdGroup } from "@/components/shadcn/kbd";
import { SHORTCUTS, type ShortcutName, shortcutTokens } from "@/lib/shortcuts";
import { Section, SettingsRow, SettingsRows } from "./parts";

// macOS shows ⌘/⌥/⇧ glyphs; other platforms spell out Ctrl/Alt/Shift.
const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

export function ShortcutsSettings() {
  const names = Object.keys(SHORTCUTS) as ShortcutName[];

  return (
    <Section title="Keyboard shortcuts" description="Speed up common actions.">
      <SettingsRows>
        {names.map((name) => (
          <SettingsRow key={name}>
            <ItemContent>
              <ItemTitle>{SHORTCUTS[name].label}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <KbdGroup>
                {shortcutTokens(SHORTCUTS[name], isMac).map((token) => (
                  <Kbd key={token}>{token}</Kbd>
                ))}
              </KbdGroup>
            </ItemActions>
          </SettingsRow>
        ))}
      </SettingsRows>
    </Section>
  );
}
