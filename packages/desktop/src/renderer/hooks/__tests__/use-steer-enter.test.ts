import { describe, expect, it, vi } from "vitest";
import {
  makeSteerEnterListener,
  type SteerEnterAui,
  type SteerEnterPlugin,
  steerEnterHandler,
} from "../use-steer-enter";

// Spec for the mid-run Enter interceptor: while the agent runs, plain Enter
// sends the composer text as a steering message; every other Enter (idle,
// modifiers, IME composition, an open popover) falls through to the library
// input's own handling.

const makeEvent = (overrides: Partial<KeyboardEvent> = {}) =>
  ({
    isComposing: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  }) as unknown as KeyboardEvent;

const makeAui = (isRunning: boolean) => {
  const send = vi.fn();
  const aui: SteerEnterAui = {
    thread: () => ({ getState: () => ({ isRunning }) }),
    composer: () => ({ send }),
  };
  return { aui, send };
};

const plugin = (consumes: boolean): SteerEnterPlugin => ({ handleKeyDown: vi.fn(() => consumes) });

describe("steerEnterHandler()", () => {
  it("should let the library handle Enter when the thread is idle", () => {
    const { aui, send } = makeAui(false);
    const event = makeEvent();
    expect(steerEnterHandler(event, aui, [])).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("should send with steer intent when Enter is pressed while the agent runs", () => {
    const { aui, send } = makeAui(true);
    const event = makeEvent();
    expect(steerEnterHandler(event, aui, [])).toBe(true);
    expect(send).toHaveBeenCalledWith({ steer: true });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("should fall through on Shift+Enter while running", () => {
    const { aui, send } = makeAui(true);
    expect(steerEnterHandler(makeEvent({ shiftKey: true }), aui, [])).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("should fall through on Ctrl+Enter while running", () => {
    const { aui, send } = makeAui(true);
    expect(steerEnterHandler(makeEvent({ ctrlKey: true }), aui, [])).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("should fall through on Meta+Enter while running", () => {
    const { aui, send } = makeAui(true);
    expect(steerEnterHandler(makeEvent({ metaKey: true }), aui, [])).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("should fall through while IME composition is active", () => {
    const { aui, send } = makeAui(true);
    expect(steerEnterHandler(makeEvent({ isComposing: true }), aui, [])).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("should fall through on a null event", () => {
    const { aui, send } = makeAui(true);
    expect(steerEnterHandler(null, aui, [])).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("should let an open popover plugin consume Enter instead of sending", () => {
    const { aui, send } = makeAui(true);
    const popover = plugin(true);
    const event = makeEvent();
    expect(steerEnterHandler(event, aui, [popover])).toBe(true);
    expect(popover.handleKeyDown).toHaveBeenCalledWith(event);
    expect(send).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("should send when no plugin consumes the Enter", () => {
    const { aui, send } = makeAui(true);
    const event = makeEvent();
    expect(steerEnterHandler(event, aui, [plugin(false), plugin(false)])).toBe(true);
    expect(send).toHaveBeenCalledWith({ steer: true });
  });
});

describe("makeSteerEnterListener()", () => {
  it("should read the registry's plugins at key time and steer", () => {
    const { aui, send } = makeAui(true);
    const popover = plugin(false);
    const listener = makeSteerEnterListener(aui, { getPlugins: () => [popover] });
    expect(listener(makeEvent())).toBe(true);
    expect(popover.handleKeyDown).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ steer: true });
  });

  it("should treat a missing registry as no plugins", () => {
    const { aui, send } = makeAui(true);
    expect(makeSteerEnterListener(aui, null)(makeEvent())).toBe(true);
    expect(send).toHaveBeenCalledWith({ steer: true });
  });
});
