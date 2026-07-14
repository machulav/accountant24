// Mention-directive parsing — the single source of truth shared by the markdown
// remark plugin (assistant replies), the user-message renderer, and chat-title
// display. A mention directive is `:type[label]` with an optional `{name=id}`
// suffix, where type is one of account/payee/tag/skill — the exact shape
// assistant-ui's default directive formatter emits from the composer (`skill`
// is a picked skill; see composer-skills.tsx). The pattern is strict (a known
// type AND bracketed content) so ordinary prose colons (`key:value`, `10:30`,
// `http://…`) and unknown directives (`:foo[bar]`) are never matched.

export type MentionType = "account" | "payee" | "tag" | "skill";

export type MentionSegment = { kind: "text"; value: string } | { kind: "mention"; type: MentionType; label: string };

const PATTERN = String.raw`:(account|payee|tag|skill)\[([^\]]+)\](?:\{name=[^}]+\})?`;

/** Fresh regex per call — avoids shared `lastIndex` state across helpers. */
const matcher = (): RegExp => new RegExp(PATTERN, "g");

/** True if the text contains at least one mention directive. */
export function hasMention(text: string): boolean {
  return matcher().test(text);
}

/** Split text into alternating plain-text and mention segments. Always returns
 *  at least one segment; text with no directives yields a single text segment. */
export function parseMentions(text: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  const re = matcher();
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const [whole, type, label] = match;
    if (match.index > last) out.push({ kind: "text", value: text.slice(last, match.index) });
    out.push({ kind: "mention", type: type as MentionType, label: label! });
    last = match.index + whole.length;
  }
  if (last < text.length || out.length === 0) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

/** Replace each directive with its plain label, for contexts that can't render
 *  chips (chat titles, the thread list). Non-directive text is left untouched. */
export function mentionsToPlainText(text: string): string {
  return text.replace(matcher(), (_whole, _type, label: string) => label);
}
