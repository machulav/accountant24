import { describe, expect, it, vi } from "vitest";
import {
  type EscapeStopComposer,
  escapeStopHandler,
  makeEscapeStopListener,
  restoreQueuedDraft,
} from "../use-escape-stop";

// Spec for Esc while the agent runs: it mirrors the library input's Esc branch
// (popover plugins first, then cancel when cancellable) and additionally gives
// a pending queued message's text back to the composer before the cancel.

const makeComposer = (o: { canCancel?: boolean; text?: string; queue?: { id: string; prompt: string }[] } = {}) => {
  const state = { canCancel: o.canCancel ?? true, text: o.text ?? "", queue: o.queue ?? [] };
  const composer: EscapeStopComposer = {
    getState: () => state,
    setText: vi.fn((text: string) => {
      state.text = text;
    }),
    cancel: vi.fn(),
  };
  return composer;
};

const makeEvent = () => ({ preventDefault: vi.fn() }) as unknown as KeyboardEvent;

const plugin = (consumes: boolean) => ({ handleKeyDown: vi.fn(() => consumes) });

describe("restoreQueuedDraft()", () => {
  it("should restore the queued text into an empty composer", () => {
    const composer = makeComposer({ queue: [{ id: "steer:0", prompt: "use 50 EUR" }] });
    restoreQueuedDraft(composer);
    expect(composer.setText).toHaveBeenCalledWith("use 50 EUR");
  });

  it("should join several queued messages with blank lines", () => {
    const composer = makeComposer({
      queue: [
        { id: "steer:0", prompt: "use 50 EUR" },
        { id: "steer:1", prompt: "and rename it" },
      ],
    });
    restoreQueuedDraft(composer);
    expect(composer.setText).toHaveBeenCalledWith("use 50 EUR\n\nand rename it");
  });

  it("should never overwrite a typed draft", () => {
    const composer = makeComposer({ text: "a fresh draft", queue: [{ id: "steer:0", prompt: "use 50 EUR" }] });
    restoreQueuedDraft(composer);
    expect(composer.setText).not.toHaveBeenCalled();
  });

  it("should do nothing when the queue is empty", () => {
    const composer = makeComposer();
    restoreQueuedDraft(composer);
    expect(composer.setText).not.toHaveBeenCalled();
  });
});

describe("escapeStopHandler()", () => {
  it("should cancel the run and restore the queued text when cancellable", () => {
    const composer = makeComposer({ queue: [{ id: "steer:0", prompt: "use 50 EUR" }] });
    const event = makeEvent();
    expect(escapeStopHandler(event, { composer: () => composer }, [])).toBe(true);
    expect(composer.setText).toHaveBeenCalledWith("use 50 EUR");
    expect(composer.cancel).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("should keep a typed draft and still cancel", () => {
    const composer = makeComposer({ text: "a fresh draft", queue: [{ id: "steer:0", prompt: "use 50 EUR" }] });
    expect(escapeStopHandler(makeEvent(), { composer: () => composer }, [])).toBe(true);
    expect(composer.setText).not.toHaveBeenCalled();
    expect(composer.cancel).toHaveBeenCalled();
  });

  it("should fall through when nothing is cancellable", () => {
    const composer = makeComposer({ canCancel: false });
    expect(escapeStopHandler(makeEvent(), { composer: () => composer }, [])).toBe(false);
    expect(composer.cancel).not.toHaveBeenCalled();
  });

  it("should let an open popover plugin consume Esc instead of cancelling", () => {
    const composer = makeComposer();
    const popover = plugin(true);
    const event = makeEvent();
    expect(escapeStopHandler(event, { composer: () => composer }, [popover])).toBe(true);
    expect(popover.handleKeyDown).toHaveBeenCalledWith(event);
    expect(composer.cancel).not.toHaveBeenCalled();
  });

  it("should cancel when no plugin consumes the Esc", () => {
    const composer = makeComposer();
    expect(escapeStopHandler(makeEvent(), { composer: () => composer }, [plugin(false)])).toBe(true);
    expect(composer.cancel).toHaveBeenCalled();
  });

  it("should cancel on a null event without a preventDefault", () => {
    const composer = makeComposer();
    expect(escapeStopHandler(null, { composer: () => composer }, [plugin(true)])).toBe(true);
    expect(composer.cancel).toHaveBeenCalled();
  });
});

describe("makeEscapeStopListener()", () => {
  it("should read the registry's plugins at key time and cancel", () => {
    const composer = makeComposer();
    const popover = plugin(false);
    const listener = makeEscapeStopListener({ composer: () => composer }, { getPlugins: () => [popover] });
    expect(listener(makeEvent())).toBe(true);
    expect(popover.handleKeyDown).toHaveBeenCalled();
    expect(composer.cancel).toHaveBeenCalled();
  });

  it("should treat a missing registry as no plugins", () => {
    const composer = makeComposer();
    expect(makeEscapeStopListener({ composer: () => composer }, null)(makeEvent())).toBe(true);
    expect(composer.cancel).toHaveBeenCalled();
  });
});
