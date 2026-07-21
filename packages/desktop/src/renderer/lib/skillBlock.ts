// Detects a manually invoked skill in a sent user message. pi expands
// `/skill:<name> <args>` into the message text itself (agent-session.js
// `_expandSkillCommand`): the full SKILL.md body wrapped in a <skill> block,
// followed by the user's own text. The thread renders that as a compact chip +
// the user's words instead of the raw instruction blob. The regex mirrors pi's
// own `parseSkillBlock` verbatim so both sides agree on the format.

export interface SkillBlock {
  /** Skill name from the block's `name` attribute. */
  name: string;
  /** Absolute path of the SKILL.md the block was expanded from. */
  location: string;
  /** The injected skill instructions (hidden by the chip rendering). */
  content: string;
  /** The user's own message after the block, if any. */
  userMessage?: string;
}

const SKILL_BLOCK_RE = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

/** Parse an expanded skill block from user-message text. Returns null when the
 *  text is not a skill invocation (plain messages pass through untouched). */
export function parseSkillBlock(text: string): SkillBlock | null {
  const match = text.match(SKILL_BLOCK_RE);
  if (!match) return null;
  const userMessage = match[4]?.trim();
  return {
    name: match[1],
    location: match[2],
    content: match[3],
    ...(userMessage ? { userMessage } : {}),
  };
}

// The composer represents a picked skill as a `:skill[name]` directive chip
// (mention-style; skill names are spec-limited to lowercase a-z, 0-9, hyphens).
const SKILL_DIRECTIVE_RE = /:skill\[([a-z0-9-]{1,64})\]/;

// The unexpanded wire form (pi passes it through literally when the skill is
// unknown, e.g. it was disabled between picking and sending).
const SKILL_PREFIX_RE = /^\/skill:([a-z0-9-]{1,64})(?:\s+([\s\S]*))?$/;

const toDirective = (name: string, args: string | undefined): string =>
  args ? `:skill[${name}] ${args}` : `:skill[${name}]`;

/** Inverse of {@link hoistSkillDirective}, applied to transcript text coming
 *  back from pi: the expanded `<skill>` block (or an unexpanded `/skill:`
 *  prefix) collapses to the exact `:skill[name] args` directive the composer
 *  sent. The round-trip must be text-identical — the runtime reconciles its
 *  optimistic copy of a sent message against the transcript by exact text, so
 *  any mismatch leaves a stray duplicate bubble. Plain text passes through. */
export function collapseSkillText(text: string): string {
  const block = parseSkillBlock(text);
  if (block) return toDirective(block.name, block.userMessage);
  const prefix = text.match(SKILL_PREFIX_RE);
  if (prefix) return toDirective(prefix[1], prefix[2]?.trim() || undefined);
  return text;
}

/** Split the first `:skill[name]` directive out of the text. The halves around
 *  the removed chip are joined with a single space so no double gap is left at
 *  the seam (whitespace inside either half stays untouched). */
function spliceSkillDirective(text: string): { name: string; rest: string } | null {
  const match = text.match(SKILL_DIRECTIVE_RE);
  if (match?.index === undefined) return null;
  const before = text.slice(0, match.index).trim();
  const after = text.slice(match.index + match[0].length).trim();
  return { name: match[1], rest: [before, after].filter(Boolean).join(" ") };
}

/** Rewrite an outgoing message from chip form to pi's wire form: the first
 *  `:skill[name]` directive is lifted out and the message gains the leading
 *  `/skill:name ` token pi expands (it only expands a leading token; the picker
 *  only arms at the start of the message, so a mid-text chip means the user
 *  typed text before it afterwards). Messages without a skill chip pass
 *  through untouched. */
export function hoistSkillDirective(text: string): string {
  const spliced = spliceSkillDirective(text);
  if (!spliced) return text;
  return spliced.rest ? `/skill:${spliced.name} ${spliced.rest}` : `/skill:${spliced.name}`;
}
