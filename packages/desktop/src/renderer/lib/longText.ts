// When a sent message is long enough that showing it in full would bury the
// conversation.
//
// Deliberately client-agnostic: an ACP client may wrap every turn in a large
// scaffold of its own (channel context, event metadata, replayed history), and
// a pasted log or stack trace does the same thing. Both are just "too long to
// show inline", so both collapse by the same rule and nothing here knows which
// client, if any, produced the text.

/** Roughly a screenful of chat at the thread's width. */
export const LONG_TEXT_CHARS = 800;

/** Long by shape rather than volume: many short lines still fill the view. */
export const LONG_TEXT_LINES = 12;

const countLines = (text: string): number => {
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lines++;
  return lines;
};

export function isLongText(text: string): boolean {
  return text.length > LONG_TEXT_CHARS || countLines(text) > LONG_TEXT_LINES;
}

/** Default cap for {@link previewLine}; well past any sidebar width, so the
 *  visual truncation stays CSS's job and this only bounds the string. */
const PREVIEW_MAX = 160;

/**
 * A one-line stand-in for a block of text: its first non-empty line, bounded.
 *
 * Used for the thread-list title, where a multi-line first message would
 * otherwise leak whatever happens to be on its first line. Returns an empty
 * string for blank input so callers can fall back.
 */
export function previewLine(text: string, max: number = PREVIEW_MAX): string {
  const first = text.split("\n").find((line) => line.trim().length > 0);
  if (!first) return "";
  const trimmed = first.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}
