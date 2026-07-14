// The inline chip for a picked skill (`:skill[name]` directive) — the skills
// sibling of MentionPill (mentions.tsx), kept separate so skill chip behavior
// can evolve independently of ledger mentions (e.g. click-to-view the skill's
// instructions later).
//
// Styling note: the baseline-locked inline-chip recipe is copied verbatim from
// MentionPill — resync when that recipe changes (see its comment for the
// measurements behind the em-based sizing).

import { ZapIcon } from "lucide-react";
import type { FC } from "react";
import { Badge } from "@/components/shadcn/badge";
import { cn } from "@/lib/utils";

// Muted dusty violet, matching the mention chips' calm per-type palette.
const SKILL_COLORS = "bg-[#e2dcee] text-[#5c4a82] dark:bg-[#342c47] dark:text-[#bcaedd]";

export const SkillPill: FC<{ label: string }> = ({ label }) => (
  <Badge
    variant="secondary"
    data-directive-type="skill"
    className={cn(
      "mx-px inline h-auto px-[0.55em] py-[0.15em] align-baseline text-[0.9em] leading-[1.3]",
      "[&>svg]:mr-[0.25em] [&>svg]:inline-block [&>svg]:size-[1.1em]! [&>svg]:align-[-0.125em]",
      SKILL_COLORS,
    )}
  >
    <ZapIcon />
    {label}
  </Badge>
);
