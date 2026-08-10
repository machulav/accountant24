// A user message's file attachment travels to the agent as text (pi only carries
// text + images to the model). We encode each file as a one-line marker so the
// agent gets the workspace path, while the chat UI strips the marker and renders
// a file chip instead of showing the raw line. Kept framework-free so both the
// attachment adapter (encode) and the message renderer (decode) can share it.

export type AttachmentRef = { name: string; path: string; size?: number };

const MARKER = "[[attachment]]";

/** One line, no internal newlines — JSON.stringify never emits any, so the
 *  decoder can split on newlines and treat a whole marker line as one ref. */
export function encodeAttachmentRef(ref: AttachmentRef): string {
  return MARKER + JSON.stringify(ref);
}

/** Split text into the human-visible remainder and the attachment refs it carried. */
export function extractAttachmentRefs(text: string): {
  text: string;
  refs: AttachmentRef[];
} {
  const refs: AttachmentRef[] = [];
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith(MARKER)) {
      // A marker line is never shown as raw text: emit a ref if it's well-formed,
      // otherwise drop it. `size` is optional — markers from before it existed
      // don't carry it — and is dropped when it isn't a plain finite number.
      try {
        const ref = JSON.parse(line.slice(MARKER.length)) as Partial<Record<keyof AttachmentRef, unknown>>;
        if (ref && typeof ref.name === "string" && typeof ref.path === "string") {
          const size = typeof ref.size === "number" && Number.isFinite(ref.size) ? ref.size : undefined;
          refs.push({ name: ref.name, path: ref.path, ...(size === undefined ? {} : { size }) });
        }
      } catch {
        // malformed marker — drop it
      }
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join("\n").trim(), refs };
}
