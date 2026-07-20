// About — read-only app info: version (with the staged-update state when one
// is pending) and links to the docs and project resources. Nothing here
// persists settings; links open in the system browser via the window-open
// handler.

import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/shadcn/button";
import { ItemActions, ItemContent, ItemTitle } from "@/components/shadcn/item";
import { useUpdateStatus } from "@/hooks/useUpdateStatus";
import { appApi, updateApi } from "@/rpc/api";
import { Section, SettingsRow, SettingsRows } from "./parts";

const RESOURCES = [
  { label: "Documentation", href: "https://accountant24.ai" },
  { label: "Changelog", href: "https://github.com/machulav/accountant24/releases" },
  { label: "Report an issue", href: "https://github.com/machulav/accountant24/issues" },
  { label: "Source code", href: "https://github.com/machulav/accountant24" },
  { label: "MIT license", href: "https://github.com/machulav/accountant24/blob/main/LICENSE" },
];

/** A whole-row external link (the Item renders as an anchor, so the stock
 *  `[a]:hover:bg-muted` affordance applies). SettingsRow strips horizontal
 *  padding to align text with the section header; for an interactive row the
 *  hover bg would then hug the text, so restore padding and pull it back out
 *  with a negative margin (the shadcn menu-item idiom), and swap the stock
 *  rounded-2xl (a pill at this row height) for the rounded-xl the app's other
 *  interactive rows use (sidebar nav, dropdown items). */
function LinkRow({ label, href }: { label: string; href: string }) {
  return (
    // biome-ignore lint/a11y/useAnchorContent: useRender injects the row children (incl. the title) into the anchor at runtime
    <SettingsRow className="-mx-2 w-auto rounded-xl px-2" render={<a href={href} target="_blank" rel="noreferrer" />}>
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <ExternalLinkIcon className="text-muted-foreground size-4" />
      </ItemActions>
    </SettingsRow>
  );
}

export function AboutSettings() {
  const [version, setVersion] = useState<string>();
  const pendingUpdate = useUpdateStatus();

  useEffect(() => {
    appApi
      .version()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  // Each release is tagged v<version> and carries its changelog section as
  // notes. Dev builds report 0.0.0-dev, which has no release page, so they
  // fall back to the releases list.
  const releaseNotesHref = version
    ? version.endsWith("-dev")
      ? "https://github.com/machulav/accountant24/releases"
      : `https://github.com/machulav/accountant24/releases/tag/v${version}`
    : undefined;

  return (
    <div>
      <Section title="Accountant24" description="Local-first AI agent for personal finance.">
        <SettingsRows>
          <SettingsRow
            className={releaseNotesHref && "-mx-2 w-auto rounded-xl px-2"}
            // biome-ignore lint/a11y/useAnchorContent: useRender injects the row children (incl. the title) into the anchor at runtime
            render={releaseNotesHref ? <a href={releaseNotesHref} target="_blank" rel="noreferrer" /> : undefined}
          >
            <ItemContent>
              <ItemTitle>Version</ItemTitle>
            </ItemContent>
            <ItemActions>
              <span className="text-muted-foreground text-sm">{version && `v${version}`}</span>
              {releaseNotesHref && <ExternalLinkIcon className="text-muted-foreground size-4" />}
            </ItemActions>
          </SettingsRow>
          {pendingUpdate && (
            <SettingsRow>
              <ItemContent>
                <ItemTitle>Update ready: v{pendingUpdate}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Button size="sm" variant="outline" onClick={() => void updateApi.install()}>
                  Relaunch to update
                </Button>
              </ItemActions>
            </SettingsRow>
          )}
        </SettingsRows>
      </Section>

      <Section title="Resources" description="Learn more, get help, and follow the project on GitHub.">
        <SettingsRows>
          {RESOURCES.map((link) => (
            <LinkRow key={link.href} {...link} />
          ))}
        </SettingsRows>
      </Section>
    </div>
  );
}
