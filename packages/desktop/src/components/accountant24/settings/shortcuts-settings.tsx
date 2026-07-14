// Shortcuts — a read-only reference of the app's keyboard shortcuts (rendered
// straight from the SHORTCUTS registry so it never drifts from what's wired
// up) plus the composer's typed triggers.

import { ItemActions, ItemContent, ItemTitle } from "@/components/shadcn/item";
import { Kbd, KbdGroup } from "@/components/shadcn/kbd";
import { SHORTCUTS, type ShortcutName, shortcutTokens } from "@/lib/shortcuts";
import { Section, SettingsRow, SettingsRows } from "./parts";

// macOS shows ⌘/⌥/⇧ glyphs; other platforms spell out Ctrl/Alt/Shift.
const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

/** Composer trigger characters: literal text the composer reacts to, not key
 *  combos, so they live outside the SHORTCUTS registry (which feeds real key
 *  matching). Listed here purely for discoverability. */
const COMPOSER_TRIGGERS = [
  { key: "@", label: "Mention an account, payee, or tag" },
  { key: "/", label: "Use a skill (at the start of a message)" },
];

export function ShortcutsSettings() {
  const names = Object.keys(SHORTCUTS) as ShortcutName[];

  return (
    <div>
      <Section title="While writing a message" description="Type these in the chat message box.">
        <SettingsRows>
          {COMPOSER_TRIGGERS.map((trigger) => (
            <SettingsRow key={trigger.key}>
              <ItemContent>
                <ItemTitle>{trigger.label}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Kbd>{trigger.key}</Kbd>
              </ItemActions>
            </SettingsRow>
          ))}
        </SettingsRows>
      </Section>

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
    </div>
  );
}
