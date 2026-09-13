// Build-time timing for one demo scene: the delay, in ms from scene
// activation, of every animated element. The host emits the delays as inline
// `--d` custom properties; the scene CSS (components/mock-scene.astro) plays
// one entrance animation per element at its delay, so runtime JS only
// toggles classes.
import type { SceneDemo } from "./types";

export interface SceneTimeline {
  /** Per attachment card appearing in the composer. */
  attachmentDelays: number[];
  /** The user types `/`, the skill picker's trigger. */
  slashAt?: number;
  /** The skill picker opens above the composer. */
  pickerAt?: number;
  /** Per row of the skill picker. */
  skillDelays: number[];
  /** The picker's highlight lands on row i, from the first row down to the picked one. */
  highlightDelays: number[];
  /** The skill is picked: the picker closes and its chip replaces the `/`. */
  pickAt?: number;
  /** Per character the user types into the composer, after the skill chip when there is one. */
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
  /** Per bullet under the reply prose, per word: streamed like the prose. */
  bulletWordDelays: number[][];
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
const ATTACHMENT_MS = 150; // between attachment cards
const ATTACHMENT_GAP_MS = 250; // typing starts this long after the last attachment card
const PICKER_START_MS = 200; // the skill picker opens after the `/`
const SKILL_ROW_MS = 80; // between skill picker rows
const HIGHLIGHT_START_MS = 1000; // the highlight leaves the first row after the last row appeared: time to read the list
const HIGHLIGHT_MS = 450; // between highlight steps down the picker
const PICK_GAP_MS = 600; // the pick after the highlight reached the skill
const PICK_TYPE_GAP_MS = 250; // typing resumes after the skill chip landed
const SEND_GAP_MS = 250; // the send after the last typed character
const WORKING_GAP_MS = 350; // "Working" appears after the message is sent
const STEP_MS = 380; // between tool steps
const DONE_GAP_MS = 250; // the "Worked for Ns" swap after the last step
const REPLY_GAP_MS = 200; // the reply after the swap
const REPLY_WORD_MS = 35; // per streamed reply word
const BULLET_START_MS = 200; // the first bullet's first word after the reply prose
const BULLET_MS = 120; // the next bullet's first word after the previous bullet's last
const CHIP_START_MS = 150; // first chip after the reply prose
const CHIP_MS = 100; // between chips
const ROW_START_MS = 200; // first table row after the reply prose
const ROW_MS = 120; // between table rows
const MODEL_START_MS = 300; // first model-menu row
const MODEL_MS = 150; // between model-menu rows
const IN_MS = 250; // entrance animation length; matches `fdemo-in` in components/mock-scene.astro
const TURN_GAP_MS = 1200; // the pause before the next turn of a conversation starts, on top of the reading time
const READ_WORD_MS = 180; // reading time granted per word the agent showed (about 330 words a minute)
const HOLD_MS = 2500; // the final frame of a conversation stays this long, on top of the reading time

/** The reply's words in order, a mention chip (`:payee[Trader Joe's]`,
 *  `:account[Expenses:Groceries]`, tag, skill) counting as one word even
 *  when its label has spaces; punctuation glued to it stays in the token. */
export function replyTokens(text: string): string[] {
  return text.match(/:(?:account|payee|tag|skill)\[[^\]]+\]\S*|\S+/g) ?? [];
}

export function buildSceneTimeline(demo: SceneDemo): SceneTimeline {
  let t = 0;

  const typeCharDelays: number[] = [];
  const attachmentDelays: number[] = [];
  const skillDelays: number[] = [];
  const highlightDelays: number[] = [];
  let slashAt: number | undefined;
  let pickerAt: number | undefined;
  let pickAt: number | undefined;
  let sendAt: number | undefined;
  if (demo.user) {
    const attachments = demo.user.attachments ?? [];
    for (let i = 0; i < attachments.length; i++) attachmentDelays.push(START_MS + i * ATTACHMENT_MS);
    const lastAttachment = attachmentDelays[attachmentDelays.length - 1];
    t = lastAttachment === undefined ? START_MS : lastAttachment + ATTACHMENT_GAP_MS;
    if (demo.user.skill) {
      const { picked, options } = demo.user.skill;
      const pickedIndex = options.findIndex((skill) => skill.name === picked);
      if (pickedIndex < 0) throw new Error(`The picked skill "${picked}" is not one of the picker's options.`);
      slashAt = t;
      pickerAt = slashAt + PICKER_START_MS;
      for (let i = 0; i < options.length; i++) skillDelays.push(pickerAt + i * SKILL_ROW_MS);
      const lastRow = skillDelays[skillDelays.length - 1] ?? pickerAt;
      // The first row is highlighted as soon as the picker opens; the
      // highlight walks down one row at a time only once every row is there.
      highlightDelays.push(pickerAt);
      for (let i = 1; i <= pickedIndex; i++)
        highlightDelays.push(lastRow + HIGHLIGHT_START_MS + (i - 1) * HIGHLIGHT_MS);
      pickAt = Math.max(lastRow, highlightDelays[highlightDelays.length - 1] ?? pickerAt) + PICK_GAP_MS;
      t = pickAt + PICK_TYPE_GAP_MS;
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

  const bulletWordDelays: number[][] = [];
  const chipDelays: number[] = [];
  const rowDelays: number[] = [];
  const replyWordDelays: number[] = [];
  let replyAt: number | undefined;
  if (demo.reply) {
    const at = t + REPLY_GAP_MS;
    replyAt = at;
    const words = replyTokens(demo.reply.text);
    for (let i = 0; i < words.length; i++) replyWordDelays.push(at + i * REPLY_WORD_MS);
    const textEnd = replyWordDelays[replyWordDelays.length - 1] ?? at;
    let proseEnd = textEnd;
    for (const [i, bullet] of (demo.reply.bullets ?? []).entries()) {
      const start = proseEnd + (i === 0 ? BULLET_START_MS : BULLET_MS);
      const bulletWords = replyTokens(bullet);
      const delays = bulletWords.map((_, wi) => start + wi * REPLY_WORD_MS);
      bulletWordDelays.push(delays);
      proseEnd = delays[delays.length - 1] ?? start;
    }
    // Chips and rows follow the prose, or the last bullet when there are any.
    const chips = demo.reply.chips ?? [];
    for (let i = 0; i < chips.length; i++) chipDelays.push(proseEnd + CHIP_START_MS + i * CHIP_MS);
    const rows = demo.reply.table?.rows ?? [];
    for (let i = 0; i < rows.length; i++) rowDelays.push(proseEnd + ROW_START_MS + i * ROW_MS);
    t = Math.max(proseEnd, chipDelays[chipDelays.length - 1] ?? proseEnd, rowDelays[rowDelays.length - 1] ?? proseEnd);
  }

  const modelDelays: number[] = [];
  const models = demo.composer?.models ?? [];
  for (let i = 0; i < models.length; i++) modelDelays.push(MODEL_START_MS + i * MODEL_MS);
  t = Math.max(t, modelDelays[modelDelays.length - 1] ?? t);

  return {
    attachmentDelays,
    slashAt,
    pickerAt,
    skillDelays,
    highlightDelays,
    pickAt,
    typeCharDelays,
    sendAt,
    workingAt,
    stepDelays,
    doneAt,
    replyAt,
    replyWordDelays,
    bulletWordDelays,
    chipDelays,
    rowDelays,
    modelDelays,
    total: t + IN_MS,
  };
}

/** How long a reader needs for everything the agent showed in a turn: the
 *  reply prose, bullets, chips, and table cells, at READ_WORD_MS per word. */
export function readingTime(demo: SceneDemo): number {
  const reply = demo.reply;
  if (!reply) return 0;
  const texts = [
    reply.text,
    ...(reply.bullets ?? []),
    ...(reply.chips ?? []).map((chip) => chip.label),
    ...(reply.table?.head ?? []),
    ...(reply.table?.rows ?? []).flat(),
  ];
  const words = texts.flatMap(replyTokens);
  return words.length * READ_WORD_MS;
}

/** The same timeline, every moment moved later by `offset` ms. */
export function shiftTimeline(timeline: SceneTimeline, offset: number): SceneTimeline {
  const at = (value: number | undefined) => (value === undefined ? undefined : value + offset);
  const all = (values: number[]) => values.map((value) => value + offset);
  return {
    attachmentDelays: all(timeline.attachmentDelays),
    slashAt: at(timeline.slashAt),
    pickerAt: at(timeline.pickerAt),
    skillDelays: all(timeline.skillDelays),
    highlightDelays: all(timeline.highlightDelays),
    pickAt: at(timeline.pickAt),
    typeCharDelays: all(timeline.typeCharDelays),
    sendAt: at(timeline.sendAt),
    workingAt: at(timeline.workingAt),
    stepDelays: all(timeline.stepDelays),
    doneAt: at(timeline.doneAt),
    replyAt: at(timeline.replyAt),
    replyWordDelays: all(timeline.replyWordDelays),
    bulletWordDelays: timeline.bulletWordDelays.map(all),
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
  /** How long the settled conversation stays on screen before a replay, ms. */
  holdAfter: number;
}

/** Turns played one after another in a single thread, each starting after
 *  the previous one settled plus the time to read what it showed. */
export function buildConversationTimeline(turns: SceneDemo[]): ConversationTimeline {
  const shifted: SceneTimeline[] = [];
  let offset = 0;
  for (const turn of turns) {
    const timeline = shiftTimeline(buildSceneTimeline(turn), offset);
    shifted.push(timeline);
    offset = timeline.total + readingTime(turn) + TURN_GAP_MS;
  }
  const last = turns[turns.length - 1];
  return {
    turns: shifted,
    total: shifted[shifted.length - 1]?.total ?? 0,
    holdAfter: last === undefined ? 0 : readingTime(last) + HOLD_MS,
  };
}
