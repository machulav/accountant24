// Chat title (the auto-generated name shown in the thread list) derived from the
// first user message. Pure and framework-free so it's unit-tested in isolation;
// ChatLayout just feeds it the message's text parts and the names of any images
// sent (images are dropped from the transcript, so the caller tracks them).
//
// Rules, in order:
//   1. Human-written text wins — `[[attachment]]` markers stripped out, mention
//      directives shown as their plain label, whitespace collapsed.
//   2. Otherwise (attachment-only message) fall back to the attached file and
//      image names, comma-joined (files first, then images).
//   3. Nothing to title from → null (the caller keeps the placeholder name).
// The result is truncated to 60 characters with an ellipsis.

import { extractAttachmentRefs } from "./attachmentMarker";
import { mentionsToPlainText } from "./mentions";

const MAX_LENGTH = 60;

export interface ChatTitleInput {
  /** Text parts of the first user message (each may embed `[[attachment]]` markers). */
  texts: string[];
  /** Names of images sent with the message (not recoverable from the transcript). */
  imageNames: string[];
}

function truncate(value: string): string {
  return value.length > MAX_LENGTH ? `${value.slice(0, MAX_LENGTH).trimEnd()}…` : value;
}

/** Derive a chat title from the first user message, or null when there's nothing
 *  to title from. */
export function deriveChatTitle({ texts, imageNames }: ChatTitleInput): string | null {
  const parts = texts.map((t) => extractAttachmentRefs(t));
  const visible = mentionsToPlainText(parts.map((p) => p.text).join(" "))
    .replace(/\s+/g, " ")
    .trim();
  const fileNames = parts.flatMap((p) => p.refs).map((r) => r.name);
  const title = visible || [...fileNames, ...imageNames].join(", ");
  return title ? truncate(title) : null;
}
