// Row pieces shared by the plugin lists: an installed row and a marketplace row
// carry the same name, description and repository, so both read the same
// whether a plugin is on disk or only listed.

import { TriangleAlertIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { ExternalLink } from "@/components/accountant24/external-link";
import { Badge } from "@/components/shadcn/badge";
import { ItemContent, ItemDescription, ItemTitle } from "@/components/shadcn/item";
import type { PluginRepo } from "@/lib/pluginRepo";
import { cn } from "@/lib/utils";
import type { PluginSkillInfo } from "@/rpc/types";

/** Description shortened to two lines with an inline "… Show more" right after
 *  the truncated text (and "Show less" after the full text): descriptions are
 *  the model's activation triggers, so the full text stays one click away. A
 *  hidden measurer with the same type styles binary-searches the cut so the
 *  text plus the toggle fills exactly two lines. */
export function ClampedDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  // null = the whole text fits in two lines; a number = cut the text here.
  const [cut, setCut] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);

  // Re-measure on width changes (window/dialog resizes reflow the text).
  useLayoutEffect(() => {
    const box = boxRef.current;
    const probe = probeRef.current;
    if (!box || !probe) return;
    const measure = () => {
      probe.textContent = "x";
      const twoLines = probe.clientHeight * 2 + 1;
      probe.textContent = text;
      let next: number | null = null;
      if (probe.clientHeight > twoLines) {
        let lo = 0;
        let hi = text.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          probe.textContent = `${text.slice(0, mid).trimEnd()}… Show more`;
          if (probe.clientHeight <= twoLines) lo = mid;
          else hi = mid - 1;
        }
        // Don't leave a split word before the ellipsis.
        const boundary = /\S/.test(text[lo] ?? " ") ? text.slice(0, lo).lastIndexOf(" ") : lo;
        next = boundary > 0 ? boundary : lo;
      }
      probe.textContent = "";
      setCut(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text]);

  const toggleClasses = "text-muted-foreground hover:text-foreground text-xs underline-offset-3 hover:underline";
  const truncated = !expanded && cut !== null;

  return (
    <div ref={boxRef} className="relative">
      <ItemDescription className={cn("text-xs", expanded && "line-clamp-none")}>
        {truncated ? `${text.slice(0, cut).trimEnd()}… ` : text}
        {truncated && (
          <button type="button" aria-expanded={false} onClick={() => setExpanded(true)} className={toggleClasses}>
            Show more
          </button>
        )}
        {expanded && (
          <>
            {" "}
            <button type="button" aria-expanded onClick={() => setExpanded(false)} className={toggleClasses}>
              Show less
            </button>
          </>
        )}
      </ItemDescription>
      {/* The measurer: same type styles, free height, no layout footprint. */}
      <ItemDescription
        ref={probeRef}
        aria-hidden
        className="invisible absolute inset-x-0 top-0 text-xs line-clamp-none"
      />
    </div>
  );
}

/** A plugin's own description, falling back to its first skill's when there is
 *  none. The app requires a description in an installed plugin's manifest, but
 *  a marketplace entry (whose manifest only the indexer saw) and an invalid
 *  plugin's row can still arrive without one. */
export function pluginDescription(plugin: { description: string; skills: PluginSkillInfo[] }): string {
  return plugin.description || plugin.skills[0]?.description || "";
}

/** Published by Accountant24. Stock secondary, like every other badge in
 *  Settings (Default, Local, a provider's connection): a badge here says what
 *  something is, and none of them shout. */
export function OfficialBadge() {
  return <Badge variant="secondary">Official</Badge>;
}

/** Where the plugin came from, next to its name: `owner/repo`, linked to the
 *  repository. Kept as visible text rather than an icon, because who published
 *  a plugin is the main thing to judge before trusting one. The trailing icon
 *  is the standard mark for a link that leaves the app; it is decorative, so
 *  the link still reads as just the repository. */
export function PluginRepoLink({ repo }: { repo: PluginRepo }) {
  return (
    <ExternalLink href={repo.url} title={`Open ${repo.label} on GitHub`} className="text-xs">
      <span className="truncate">{repo.label}</span>
    </ExternalLink>
  );
}

/** Something about the plugin the user has to know, like a skill that another
 *  plugin already claims. Muted, with the warning icon: the icon says what
 *  kind of line this is, and the row stays as quiet as its neighbours. */
export function PluginWarning({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground mt-1 flex items-start gap-1.5 text-xs">
      <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A plugin as it reads everywhere it appears: its name, where it came from,
 *  and what it does. The installed list, the marketplace list and the install
 *  dialog all show a plugin the same way, so they draw it with one component
 *  instead of three near-copies. */
export function PluginIdentity({
  name,
  version,
  official,
  repo,
  description,
  badges,
  children,
}: {
  name: string;
  version?: string;
  official?: boolean;
  /** Its repository, absent for a plugin that came from neither GitHub nor us. */
  repo?: PluginRepo;
  description: string;
  /** Extra badges after the name, for what only one list knows (Manual, Invalid). */
  badges?: React.ReactNode;
  /** Anything below the description, like a skill another plugin already claims. */
  children?: React.ReactNode;
}) {
  return (
    <ItemContent className="gap-0.5">
      <ItemTitle className="max-w-full">
        <span className="truncate">{name}</span>
        {version && <span className="text-muted-foreground font-normal">{version}</span>}
        {official && <OfficialBadge />}
        {repo && <PluginRepoLink repo={repo} />}
        {badges}
      </ItemTitle>
      <ClampedDescription text={description} />
      {children}
    </ItemContent>
  );
}
