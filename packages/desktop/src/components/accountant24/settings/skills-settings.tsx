// Skills — what the chat agent can do. Two kinds: native skills embedded in
// the app bundle (always on, no controls) and custom skills added as
// folders in the workspace (~/Accountant24/skills), which can be toggled,
// removed, or added from a public GitHub repo. The agent child is restarted
// after any change so its --skill flags reflect the store. Mirrors the
// Providers/Models pages: same sections, rows, badges, and busy patterns.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/shadcn/item";
import { Label } from "@/components/shadcn/label";
import { Spinner } from "@/components/shadcn/spinner";
import { Switch } from "@/components/shadcn/switch";
import { cn } from "@/lib/utils";
import { agentApi, skillsApi } from "@/rpc/api";
import type { SkillInfo, SkillsList } from "@/rpc/types";
import { ErrorBanner, Section, SettingsRow, SettingsRows } from "./parts";
import { AddSkillDialog, RemoveSkillDialog } from "./skill-dialogs";

/** Skill description shortened to two lines with an inline "… Show more"
 *  right after the truncated text (and "Show less" after the full text):
 *  descriptions are the model's activation triggers, so the full text stays
 *  one click away. A hidden measurer with the same type styles binary-searches
 *  the cut so the text plus the toggle fills exactly two lines. */
function SkillDescription({ text }: { text: string }) {
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

// ---- Custom ------------------------------------------------------------

function CustomSkillRow({
  skill,
  onToggle,
  onRemove,
}: {
  skill: SkillInfo;
  onToggle: (enabled: boolean) => void;
  /** Opens the remove confirmation; the dialog owns the busy state. */
  onRemove: () => void;
}) {
  const switchId = `enabled-skill-${skill.name}`;

  return (
    <SettingsRow>
      <ItemContent className="gap-0.5">
        <ItemTitle className="max-w-full">
          {/* Label + htmlFor (not a wrapping label): a Switch inside a wrapping
              label double-fires and cancels the toggle. */}
          <Label htmlFor={switchId} className="block truncate font-normal">
            {skill.name}
          </Label>
          <Badge variant="secondary">{skill.source ?? "Manual"}</Badge>
          {skill.error && <Badge variant="destructive">Invalid</Badge>}
        </ItemTitle>
        <SkillDescription text={skill.error ?? skill.description} />
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline" className="w-28" onClick={onRemove}>
          Remove
        </Button>
        <Switch
          id={switchId}
          checked={skill.enabled}
          disabled={Boolean(skill.error)}
          onCheckedChange={(checked) => onToggle(checked)}
        />
      </ItemActions>
    </SettingsRow>
  );
}

// ---- Built-in ----------------------------------------------------------------

/** A native skill embedded in the app: informational row only — always on,
 *  no toggle, no remove. */
function NativeSkillRow({ skill }: { skill: SkillInfo }) {
  return (
    <SettingsRow>
      <ItemContent className="gap-0.5">
        <ItemTitle className="max-w-full">
          <span className="truncate">{skill.name}</span>
        </ItemTitle>
        <SkillDescription text={skill.description} />
      </ItemContent>
    </SettingsRow>
  );
}

// ---- Page --------------------------------------------------------------------

export function SkillsSettings() {
  const [skills, setSkills] = useState<SkillsList | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Toggles patch optimistically; concurrent reloads must not roll them back.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const next = await skillsApi.list();
    if (alive.current) setSkills(next);
  }, []);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  // Add/remove change what the agent sees, so restart it (it caches skills
  // at startup) — the providers afterAdd pattern.
  const afterChange = useCallback(async () => {
    await agentApi.restart();
    await reload();
  }, [reload]);

  const toggle = useCallback((name: string, enabled: boolean) => {
    // Optimistic flip; the agent restart happens in the background.
    setSkills((prev) =>
      prev ? { ...prev, skills: prev.skills.map((s) => (s.name === name ? { ...s, enabled } : s)) } : prev,
    );
    setSaveError(null);
    skillsApi
      .setEnabled(name, enabled)
      .then(() => agentApi.restart())
      .catch((e) => setSaveError(`Couldn’t save skills: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  const remove = useCallback(
    async (name: string) => {
      setSaveError(null);
      try {
        const result = await skillsApi.remove(name);
        if (result.type === "error") throw new Error(result.message ?? "Failed to remove skill");
        await afterChange();
      } catch (e) {
        setSaveError(String(e));
      }
    },
    [afterChange],
  );

  if (!skills) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
        <Spinner /> Loading skills…
      </div>
    );
  }

  const natives = skills.skills.filter((s) => s.native);
  const thirdParty = skills.skills.filter((s) => !s.native);

  return (
    <div>
      {saveError && (
        <div className="px-6 pt-5">
          <ErrorBanner message={saveError} />
        </div>
      )}

      {natives.length > 0 && (
        <Section title="Built-in" description="Skills provided by the app. Always available.">
          <SettingsRows>
            {natives.map((skill) => (
              <NativeSkillRow key={skill.name} skill={skill} />
            ))}
          </SettingsRows>
        </Section>
      )}

      {thirdParty.length > 0 && (
        <Section title="Custom" description="Custom skills you added.">
          <SettingsRows>
            {thirdParty.map((skill) => (
              <CustomSkillRow
                key={skill.name}
                skill={skill}
                onToggle={(enabled) => toggle(skill.name, enabled)}
                onRemove={() => setRemoveTarget(skill.name)}
              />
            ))}
          </SettingsRows>
        </Section>
      )}

      <Section title="Add from GitHub repository" description="Add any skill from a public GitHub repository.">
        <div>
          <Button size="sm" variant="outline" onClick={() => setAddDialogOpen(true)}>
            Add skill
          </Button>
        </div>
      </Section>

      <AddSkillDialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} onAdded={afterChange} />
      <RemoveSkillDialog skill={removeTarget} onClose={() => setRemoveTarget(null)} onRemove={remove} />
    </div>
  );
}
