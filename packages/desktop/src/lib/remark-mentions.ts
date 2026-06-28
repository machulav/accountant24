// Remark plugin: render mention directives in assistant markdown as chips.
//
// The model is asked to reference ledger entities with the same directive form
// the composer uses — `:account[Full:Name]`, `:payee[Name]`, `:tag[name]`. This
// walks the mdast and splits any `text` node on those directives (see
// `parseMentions`), replacing each with a node that becomes
// `<span data-mention-type data-mention-label>` in hast — picked up by the `span`
// override in markdown-text.tsx and rendered as a MentionPill. Code spans and
// fenced blocks are mdast `inlineCode`/`code` nodes (not `text`), so they're left
// literal. Dependency-free (no unist-util-visit / mdast types) — parsing lives in
// the tested `./mentions` module.

import { parseMentions } from "./mentions";

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
};

/** Split a text node's value into text + mention mdast nodes, or null if it
 *  contains no mention directive (leave the node untouched). */
function splitText(value: string): MdNode[] | null {
  const segments = parseMentions(value);
  if (segments.length === 1 && segments[0]!.kind === "text") return null;
  return segments.map((seg) =>
    seg.kind === "text"
      ? { type: "text", value: seg.value }
      : {
          type: "mention",
          data: { hName: "span", hProperties: { "data-mention-type": seg.type, "data-mention-label": seg.label } },
          children: [{ type: "text", value: seg.label }],
        },
  );
}

function walk(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const parts = splitText(child.value);
      if (parts) {
        next.push(...parts);
        continue;
      }
    }
    walk(child);
    next.push(child);
  }
  node.children = next;
}

/** Remark plugin (use in `remarkPlugins`). */
export function remarkMentions() {
  return (tree: MdNode): void => walk(tree);
}
