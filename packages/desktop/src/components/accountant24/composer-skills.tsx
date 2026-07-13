"use client";

// Skills picker for the chat composer: type `/` to search your skills and
// invoke one manually. The popover UI lives in composer-skills-popover.tsx
// (deliberately separate from the mentions popover — different business
// logic); this module owns the data: which skills are offered and how they are
// searched. Selecting a skill drops a `:skill[name]` chip into the composer;
// on send the message is rewritten to pi's leading `/skill:name ` token
// (hoistSkillDirective), which pi expands into the skill's instructions
// server-side. Skills are model-invoked by description automatically — this
// picker is the explicit override, and the only way to reach
// `disable-model-invocation` skills.

import type { Unstable_TriggerItem } from "@assistant-ui/react";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { agentApi, skillsApi } from "@/rpc/api";
import type { SkillInfo } from "@/rpc/types";
import { ComposerSkillsPopover, type SkillsTriggerAdapter } from "./composer-skills-popover";

/** Shape the skills into a flat trigger adapter: no categories, and a search
 *  that matches on name or description (empty query lists everything). The
 *  full description travels on the item — the popover clamps it visually.
 *  Built-in skills sort before custom ones (the popover draws the group
 *  boundary from `metadata.native`); the sort is an explicit contract here,
 *  not an accident of the IPC payload order. */
export function createSkillsAdapter(skills: SkillInfo[]): SkillsTriggerAdapter {
  const items: Unstable_TriggerItem[] = [...skills]
    .sort((a, b) => Number(b.native === true) - Number(a.native === true))
    .map((skill) => ({
      id: skill.name,
      type: "skill",
      label: skill.name,
      description: skill.description,
      metadata: { native: skill.native === true },
    }));
  return {
    categories: () => [],
    categoryItems: () => [],
    search: (query) => {
      const q = query.toLowerCase();
      if (!q) return items;
      return items.filter(
        (item) => item.label.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q),
      );
    },
  };
}

/** Load the enabled skills once on mount and refresh after every agent restart
 *  (the models-changed event) — every skills mutation in Settings restarts the
 *  agent, so that event is exactly the "skill set changed" signal. */
export function useEnabledSkills(): SkillInfo[] {
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  const refresh = useCallback(() => {
    let cancelled = false;
    skillsApi
      .list()
      .then((r) => {
        if (!cancelled) setSkills(r.skills.filter((s) => s.enabled && !s.error));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => {
    let cancelCurrent: (() => void) | undefined;
    const off = agentApi.onModelsChanged(() => {
      cancelCurrent?.();
      cancelCurrent = refresh();
    });
    return () => {
      off();
      cancelCurrent?.();
    };
  }, [refresh]);

  return skills;
}

const EMPTY_LABEL = "No skills yet. Add them in Settings → Skills";

/** The `/` skills picker. Render inside the composer (within a
 *  `ComposerPrimitive.Unstable_TriggerPopoverRoot`), as a sibling of the
 *  `@`-mentions popover. */
export const ComposerSkills: FC = () => {
  const skills = useEnabledSkills();
  const adapter = useMemo(() => createSkillsAdapter(skills), [skills]);
  return <ComposerSkillsPopover adapter={adapter} emptyLabel={EMPTY_LABEL} />;
};
