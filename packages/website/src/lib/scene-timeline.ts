// Build-time timing for one feature demo scene: the delay, in ms from scene
// activation, of every animated element. feature-mock.astro emits the delays
// as inline `--d` custom properties; the scene CSS plays one entrance
// animation per element at its delay, so runtime JS only toggles classes.
import type { SceneDemo } from "../content/site";

export interface SceneTimeline {
  /** The attachment card appears in the composer. */
  attachmentAt?: number;
  /** Per character the user types into the composer. */
  typeCharDelays: number[];
  /** The message is sent: the composer clears and the bubble lands in the thread. */
  sendAt?: number;
  /** The "Working" shimmer row appears. */
  workingAt?: number;
  /** Per tool step on the rail. */
  stepDelays: number[];
  /** "Working" swaps to "Worked for Ns". */
  doneAt?: number;
  /** The assistant prose appears. */
  replyAt?: number;
  /** Per assistant-reply word, streamed like tokens. */
  replyWordDelays: number[];
  /** Per entity chip under the reply. */
  chipDelays: number[];
  /** Per table row under the reply. */
  rowDelays: number[];
  /** Per row of the open model menu (composer scenes). */
  modelDelays: number[];
  /** Scene length: past this every element has settled. */
  total: number;
}

const START_MS = 150; // scene lead-in before the first element
const TYPE_CHAR_MS = 30; // per character typed into the composer
const ATTACHMENT_GAP_MS = 250; // typing starts this long after the attachment card
const SEND_GAP_MS = 250; // the send after the last typed character
const WORKING_GAP_MS = 350; // "Working" appears after the message is sent
const STEP_MS = 380; // between tool steps
const DONE_GAP_MS = 250; // the "Worked for Ns" swap after the last step
const REPLY_GAP_MS = 200; // the reply after the swap
const REPLY_WORD_MS = 35; // per streamed reply word
const CHIP_START_MS = 150; // first chip after the reply prose
const CHIP_MS = 100; // between chips
const ROW_START_MS = 200; // first table row after the reply prose
const ROW_MS = 120; // between table rows
const MODEL_START_MS = 300; // first model-menu row
const MODEL_MS = 150; // between model-menu rows
const IN_MS = 250; // entrance animation length; matches `fdemo-in` in mock-scene.astro
const TURN_GAP_MS = 1200; // the pause before the next turn of a conversation starts

export function buildSceneTimeline(demo: SceneDemo): SceneTimeline {
  let t = 0;

  const typeCharDelays: number[] = [];
  let attachmentAt: number | undefined;
  let sendAt: number | undefined;
  if (demo.user) {
    if (demo.user.attachment) {
      attachmentAt = START_MS;
      t = attachmentAt + ATTACHMENT_GAP_MS;
    } else {
      t = START_MS;
    }
    const chars = [...demo.user.text.trim()];
    for (let i = 0; i < chars.length; i++) typeCharDelays.push(t + i * TYPE_CHAR_MS);
    sendAt = (typeCharDelays[typeCharDelays.length - 1] ?? t) + SEND_GAP_MS;
    t = sendAt;
  }

  const stepDelays: number[] = [];
  let workingAt: number | undefined;
  let doneAt: number | undefined;
  if (demo.working) {
    const at = t + WORKING_GAP_MS;
    workingAt = at;
    for (let i = 0; i < demo.working.steps.length; i++) stepDelays.push(at + (i + 1) * STEP_MS);
    doneAt = (stepDelays[stepDelays.length - 1] ?? at) + DONE_GAP_MS;
    t = doneAt;
  }

  const chipDelays: number[] = [];
  const rowDelays: number[] = [];
  const replyWordDelays: number[] = [];
  let replyAt: number | undefined;
  if (demo.reply) {
    const at = t + REPLY_GAP_MS;
    replyAt = at;
    const words = demo.reply.text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) replyWordDelays.push(at + i * REPLY_WORD_MS);
    const textEnd = replyWordDelays[replyWordDelays.length - 1] ?? at;
    const chips = demo.reply.chips ?? [];
    for (let i = 0; i < chips.length; i++) chipDelays.push(textEnd + CHIP_START_MS + i * CHIP_MS);
    const rows = demo.reply.table?.rows ?? [];
    for (let i = 0; i < rows.length; i++) rowDelays.push(textEnd + ROW_START_MS + i * ROW_MS);
    t = Math.max(textEnd, chipDelays[chipDelays.length - 1] ?? textEnd, rowDelays[rowDelays.length - 1] ?? textEnd);
  }

  const modelDelays: number[] = [];
  const models = demo.composer?.models ?? [];
  for (let i = 0; i < models.length; i++) modelDelays.push(MODEL_START_MS + i * MODEL_MS);
  t = Math.max(t, modelDelays[modelDelays.length - 1] ?? t);

  return {
    attachmentAt,
    typeCharDelays,
    sendAt,
    workingAt,
    stepDelays,
    doneAt,
    replyAt,
    replyWordDelays,
    chipDelays,
    rowDelays,
    modelDelays,
    total: t + IN_MS,
  };
}

/** The same timeline, every moment moved later by `offset` ms. */
export function shiftTimeline(timeline: SceneTimeline, offset: number): SceneTimeline {
  const at = (value: number | undefined) => (value === undefined ? undefined : value + offset);
  const all = (values: number[]) => values.map((value) => value + offset);
  return {
    attachmentAt: at(timeline.attachmentAt),
    typeCharDelays: all(timeline.typeCharDelays),
    sendAt: at(timeline.sendAt),
    workingAt: at(timeline.workingAt),
    stepDelays: all(timeline.stepDelays),
    doneAt: at(timeline.doneAt),
    replyAt: at(timeline.replyAt),
    replyWordDelays: all(timeline.replyWordDelays),
    chipDelays: all(timeline.chipDelays),
    rowDelays: all(timeline.rowDelays),
    modelDelays: all(timeline.modelDelays),
    total: timeline.total + offset,
  };
}

export interface ConversationTimeline {
  /** One timeline per turn, already shifted to its place in the conversation. */
  turns: SceneTimeline[];
  /** When the whole conversation has settled, ms. */
  total: number;
}

/** Turns played one after another in a single thread, each starting a pause after the previous one settled. */
export function buildConversationTimeline(turns: SceneDemo[]): ConversationTimeline {
  const shifted: SceneTimeline[] = [];
  let offset = 0;
  for (const turn of turns) {
    const timeline = shiftTimeline(buildSceneTimeline(turn), offset);
    shifted.push(timeline);
    offset = timeline.total + TURN_GAP_MS;
  }
  return { turns: shifted, total: shifted[shifted.length - 1]?.total ?? 0 };
}
