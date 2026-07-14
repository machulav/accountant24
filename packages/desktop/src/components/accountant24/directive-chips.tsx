// Routing layer for directive chips. Message text can carry two kinds of
// directives — ledger mentions (`:account/:payee/:tag[…]`) and picked skills
// (`:skill[…]`) — each with its own chip component (MentionPill / SkillPill,
// deliberately separate business logic). The three surfaces that meet mixed
// directive text route through here: the Lexical composer chip, sent user
// messages, and assistant markdown replies.

import type { TextMessagePartComponent } from "@assistant-ui/react";
import type { DirectiveChipProps } from "@assistant-ui/react-lexical";
import type { FC } from "react";
import { MentionPill } from "@/components/accountant24/mentions";
import { SkillPill } from "@/components/accountant24/skill-pill";
import { parseMentions } from "@/lib/mentions";

/** The chip for a single directive, routed by type. */
export const DirectivePill: FC<{ type: string; label: string }> = ({ type, label }) =>
  type === "skill" ? <SkillPill label={label} /> : <MentionPill type={type} label={label} />;

/** Inline chip rendered inside the Lexical composer input for an inserted
 *  directive. */
export const DirectiveChip: FC<DirectiveChipProps> = ({ directiveType, label }) => (
  <DirectivePill type={directiveType} label={label} />
);

/** Renders a sent user-message text part, turning directives into the same
 *  inline chips the composer shows (plain text passes through untouched). */
export const DirectiveText: TextMessagePartComponent = ({ text }) => {
  const segments = parseMentions(text);
  if (segments.length === 1 && segments[0]?.kind === "text") {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i} className="whitespace-pre-wrap">
            {seg.value}
          </span>
        ) : (
          <DirectivePill key={i} type={seg.type} label={seg.label} />
        ),
      )}
    </>
  );
};
