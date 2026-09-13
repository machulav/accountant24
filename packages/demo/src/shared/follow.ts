// The thread follows a scene as it plays, like the app's thread sticking to
// the bottom while a reply streams in: whatever the scene has revealed so far
// stays in view, and the thread glides down to it a little every frame rather
// than jumping a line at a time. Needed wherever a conversation is taller
// than the window that plays it, which on a phone is every time.

export interface Reveal {
  /** When the element appears, ms from scene activation. */
  at: number;
  /** The element's bottom edge, px from the top of the thread's content. */
  bottom: number;
}

/** The latest revealed line ends this far above the thread's bottom edge. */
const PAD_PX = 12;
/** The share of the remaining distance the thread covers per frame. */
const GLIDE = 0.2;
/** Every element in a thread the scene reveals at its `--d` moment. */
const REVEALED = "[data-fx], .fx-stream, .fx-working";

/** `1234ms` (a `--d` value) as a number; undefined when it is not a number. */
export function parseMs(value: string): number | undefined {
  const ms = Number.parseFloat(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Where the thread should be scrolled `elapsed` ms into the run: far enough
 *  that the lowest element revealed by then ends `pad` px above the bottom of
 *  a `viewport` px tall thread, and never above the top. */
export function followTarget(reveals: Reveal[], elapsed: number, viewport: number, pad = PAD_PX): number {
  let bottom = 0;
  for (const reveal of reveals) {
    if (reveal.at <= elapsed && reveal.bottom > bottom) bottom = reveal.bottom;
  }
  return Math.max(0, bottom + pad - viewport);
}

/** The next scroll position on the way from `current` to `target`: a fifth
 *  of the remaining distance, snapping once within a pixel. */
export function glide(current: number, target: number): number {
  const remaining = target - current;
  return Math.abs(remaining) < 1 ? target : current + remaining * GLIDE;
}

export interface ThreadFollower {
  /** Scroll the thread to the top and note where every animated element
   *  sits. Call once the scene is displayed, right before it plays. From
   *  then on the notes follow the layout by themselves: whenever the thread
   *  or its content changes size (a web font arriving after the first
   *  frames, the phone turning) they are taken again. */
  measure(): void;
  /** Follow a run that started at `startedAt` (a `performance.now()` time),
   *  until everything is revealed and the thread has caught up. */
  run(startedAt: number): void;
  /** Stop following; the thread stays where it is. */
  stop(): void;
}

export function createThreadFollower(thread: HTMLElement): ThreadFollower {
  let reveals: Reveal[] = [];
  let lastAt = 0;
  let frame = 0;
  // The thread's size, taken with the notes. Read every frame it made the
  // browser lay the page out again whenever anything else had moved since
  // the last frame, which during a scene is always: the single biggest cost
  // of a run on a phone.
  let viewport = 0;
  let maxScroll = 0;
  let measured = false;
  /** A run reached its end: everything revealed, the thread caught up. */
  let done = false;

  // Note where things sit, at whatever scroll position the thread is in:
  // positions are kept from the top of the content, so the notes stay right
  // as the thread scrolls. Layout is read in one place, once per note.
  const note = () => {
    const origin = thread.getBoundingClientRect().top - thread.scrollTop;
    viewport = thread.clientHeight;
    // The browser would clamp a target past the end anyway; clamping here
    // lets the glide actually arrive, so a run knows when it is done.
    maxScroll = Math.max(0, thread.scrollHeight - viewport);
    reveals = [];
    for (const el of thread.querySelectorAll<HTMLElement>(REVEALED)) {
      const at = parseMs(el.style.getPropertyValue("--d"));
      if (at !== undefined) reveals.push({ at, bottom: el.getBoundingClientRect().bottom - origin });
    }
    lastAt = Math.max(0, ...reveals.map((reveal) => reveal.at));
    measured = true;
  };
  /** Where a finished run rests: everything revealed, in view. */
  const restingPlace = () => Math.min(followTarget(reveals, Number.POSITIVE_INFINITY, viewport), maxScroll);

  // The layout under the notes moves after the first frames of a fresh
  // load: a web font arrives and the text wraps differently, or the phone
  // turns. Notes taken before that would leave the thread short of what it
  // should show, by a line or so at the end. So they are taken again on any
  // size change of the thread or its content, and a run already over is
  // moved to where it should have ended.
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      if (!measured) return;
      note();
      if (done) thread.scrollTop = restingPlace();
    });
    observer.observe(thread);
    for (const child of thread.children) observer.observe(child);
  }

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  return {
    measure() {
      thread.scrollTop = 0;
      done = false;
      note();
    },
    run(startedAt) {
      stop();
      done = false;
      // Where the thread is as the run starts (a resumed run picks up from
      // there), then tracked here: the browser rounds what it is given, and
      // reading it back would cost a layout per frame.
      let current = thread.scrollTop;
      const tick = () => {
        const elapsed = performance.now() - startedAt;
        const target = Math.min(followTarget(reveals, elapsed, viewport), maxScroll);
        const next = glide(current, target);
        if (next !== current) {
          current = next;
          thread.scrollTop = next;
        }
        if (elapsed > lastAt && next === target) {
          frame = 0;
          done = true;
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    },
    stop,
  };
}
