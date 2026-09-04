"use client";

// Skills picker for the chat composer: type `/` to search your skills and
// invoke one manually. The popover UI lives in composer-skills-popover.tsx
// (deliberately separate from the mentions popover — different business
// logic); this module owns the data: which skills are offered and how they are
// searched. Skills come from plugins, and are named `<plugin>:<skill>`
// throughout. Selecting one drops a `:skill[plugin:name]` chip into the
// composer; on send the message is rewritten to pi's leading
// `/skill:plugin:name ` token (hoistSkillDirective), which pi expands into the
// skill's instructions server-side. Skills are model-invoked by description
// automatically — this picker is the explicit override, and the only way to
// reach `disable-model-invocation` skills.

import type { Unstable_TriggerItem } from "@assistant-ui/react";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { usePluginsStoreChanged } from "@/hooks/use-plugins-store-changed";
import { isOfficial } from "@/lib/pluginRepo";
import { agentApi, pluginsApi } from "@/rpc/api";
import type { PluginInfo } from "@/rpc/types";
import { ComposerSkillsPopover, type SkillsTriggerAdapter } from "./composer-skills-popover";

/** One offerable skill, flattened out of the plugin that provides it. */
export interface PickerSkill {
  /** `<plugin>:<skill>` — what the chip carries and pi resolves. */
  name: string;
  description: string;
  /** Provided by a built-in plugin (the popover's group boundary). */
  official: boolean;
}

/** Flatten the plugin list into the skills the agent can actually run: every
 *  plugin's skills, minus any that failed to load. */
export function pickerSkills(plugins: PluginInfo[]): PickerSkill[] {
  return plugins
    .filter((plugin) => !plugin.error)
    .flatMap((plugin) =>
      plugin.skills
        .filter((skill) => !skill.error)
        .map((skill) => ({ name: skill.name, description: skill.description, official: isOfficial(plugin) })),
    );
}

/** Shape the skills into a flat trigger adapter: no categories, and a search
 *  that narrows by name first (empty query lists everything). The full
 *  description travels on the item — the popover clamps it visually. Official
 *  skills sort before community ones; the sort is an explicit contract here,
 *  not an accident of the IPC payload order. */
export function createSkillsAdapter(skills: PickerSkill[]): SkillsTriggerAdapter {
  const items: Unstable_TriggerItem[] = [...skills]
    .sort((a, b) => Number(b.official) - Number(a.official))
    .map((skill) => ({
      id: skill.name,
      type: "skill",
      label: skill.name,
      description: skill.description,
    }));
  return {
    categories: () => [],
    categoryItems: () => [],
    // Name matches win outright; descriptions are only consulted when nothing
    // matches by name. A skill's description is long prose written to steer the
    // model, so matching it alongside names buries the skill the user is
    // actually typing: "crea" names create-plugin, but also appears inside
    // "increases" in two unrelated descriptions. Falling back keeps
    // descriptions useful for discovery ("cancel" finds subscription-audit)
    // without letting them swamp a deliberate name search.
    search: (query) => {
      const q = query.toLowerCase();
      if (!q) return items;
      const byName = items.filter((item) => item.label.toLowerCase().includes(q));
      if (byName.length > 0) return byName;
      return items.filter((item) => item.description?.toLowerCase().includes(q));
    },
  };
}

/** Load the available skills once on mount and refresh after every agent
 *  restart (the models-changed event) — every plugin mutation in Settings
 *  restarts the agent, so that event is exactly the "skill set changed"
 *  signal. */
export function useEnabledSkills(): PickerSkill[] {
  const [skills, setSkills] = useState<PickerSkill[]>([]);

  const refresh = useCallback(() => {
    let cancelled = false;
    pluginsApi
      .list()
      .then((r) => {
        if (!cancelled) setSkills(pickerSkills(r.plugins));
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

  // Main can install a plugin on its own (the default plugins, on a first
  // launch that reached the network), and that never goes through the restart
  // above, so the picker listens for it directly.
  usePluginsStoreChanged(refresh);

  return skills;
}

// Two different empty states, told apart the way the mentions popover does it:
// nothing installed at all, versus nothing matching what was typed.
const NO_SKILLS_LABEL = "No skills available";
const NO_MATCH_LABEL = "No matching skills";

/** The `/` skills picker. Render inside the composer (within a
 *  `ComposerPrimitive.Unstable_TriggerPopoverRoot`), as a sibling of the
 *  `@`-mentions popover. */
export const ComposerSkills: FC = () => {
  const skills = useEnabledSkills();
  const adapter = useMemo(() => createSkillsAdapter(skills), [skills]);
  return (
    <ComposerSkillsPopover adapter={adapter} emptyLabel={skills.length === 0 ? NO_SKILLS_LABEL : NO_MATCH_LABEL} />
  );
};
