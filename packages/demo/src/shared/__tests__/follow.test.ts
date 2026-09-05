// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThreadFollower, followTarget, glide, parseMs, type Reveal } from "../follow";

const reveal = (at: number, bottom: number): Reveal => ({ at, bottom });

describe("parseMs()", () => {
  it("should read the number out of a millisecond value", () => {
    expect(parseMs("1234ms")).toBe(1234);
  });

  it("should accept leading whitespace, as browsers keep it for custom properties", () => {
    expect(parseMs(" 20ms")).toBe(20);
  });

  it("should return 0 for 0ms", () => {
    expect(parseMs("0ms")).toBe(0);
  });

  it("should return undefined when the property is unset", () => {
    expect(parseMs("")).toBeUndefined();
  });

  it("should return undefined for a value that is not a number", () => {
    expect(parseMs("auto")).toBeUndefined();
  });
});

describe("followTarget()", () => {
  const reveals = [reveal(100, 40), reveal(200, 120), reveal(300, 260), reveal(400, 380)];

  it("should stay at the top while nothing is revealed", () => {
    expect(followTarget(reveals, 50, 200)).toBe(0);
  });

  it("should stay at the top while everything revealed fits the viewport", () => {
    // 120 + 12 = 132 <= 200.
    expect(followTarget(reveals, 250, 200)).toBe(0);
  });

  it("should scroll so the lowest revealed element ends 12px above the bottom", () => {
    // 260 + 12 - 200.
    expect(followTarget(reveals, 350, 200)).toBe(72);
  });

  it("should count an element revealed exactly now", () => {
    expect(followTarget(reveals, 300, 200)).toBe(72);
  });

  it("should ignore elements still to come", () => {
    expect(followTarget(reveals, 399, 200)).toBe(72);
    expect(followTarget(reveals, 400, 200)).toBe(192);
  });

  it("should follow the lowest revealed element, not the latest", () => {
    expect(followTarget([reveal(100, 300), reveal(200, 50)], 250, 200)).toBe(112);
  });

  it("should use the given padding", () => {
    expect(followTarget(reveals, 350, 200, 0)).toBe(60);
  });

  it("should return 0 with no reveals", () => {
    expect(followTarget([], 1000, 200)).toBe(0);
  });
});

describe("glide()", () => {
  it("should cover a fifth of the remaining distance", () => {
    expect(glide(0, 100)).toBe(20);
    expect(glide(20, 100)).toBe(36);
  });

  it("should glide upwards too", () => {
    expect(glide(100, 0)).toBe(80);
  });

  it("should snap to the target once within a pixel", () => {
    expect(glide(99.2, 100)).toBe(100);
    expect(glide(100.9, 100)).toBe(100);
  });

  it("should stay put at the target", () => {
    expect(glide(100, 100)).toBe(100);
  });

  it("should not snap at exactly a pixel away", () => {
    expect(glide(99, 100)).toBe(99.2);
  });
});

describe("createThreadFollower()", () => {
  interface Part {
    /** The element's inline `--d`; absent for an element that never animates. */
    d?: string;
    /** Bottom edge, px from the thread's top. */
    bottom: number;
    className?: string;
  }
  const THREAD_TOP = 100;

  /** A thread element with jsdom's missing layout stubbed in: its size, a
   *  working scrollTop, and children measured at the given bottoms. The
   *  size and the parts are read live, so a test can change the layout under
   *  a running follower; children's rects move up as the thread scrolls,
   *  like real ones. */
  function buildThread(size: { clientHeight: number; scrollHeight: number }, parts: Part[]): HTMLElement {
    const thread = document.createElement("div");
    let scrollTop = 0;
    // Configurable so a test can swap one in that counts its reads.
    Object.defineProperties(thread, {
      clientHeight: { get: () => size.clientHeight, configurable: true },
      scrollHeight: { get: () => size.scrollHeight, configurable: true },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, size.scrollHeight - size.clientHeight));
        },
      },
    });
    thread.getBoundingClientRect = () => ({ top: THREAD_TOP }) as DOMRect;
    for (const part of parts) {
      const el = document.createElement("span");
      el.className = part.className ?? "fx-stream";
      if (part.d !== undefined) el.setAttribute("style", `--d:${part.d}`);
      el.getBoundingClientRect = () => ({ bottom: THREAD_TOP + part.bottom - thread.scrollTop }) as DOMRect;
      thread.append(el);
    }
    return thread;
  }

  /** jsdom has no ResizeObserver; this one records its callbacks so a test
   *  can announce a layout change. */
  class FakeResizeObserver {
    static callbacks: (() => void)[] = [];
    static observed: Element[] = [];
    constructor(callback: () => void) {
      FakeResizeObserver.callbacks.push(callback);
    }
    observe(target: Element) {
      FakeResizeObserver.observed.push(target);
    }
    unobserve() {}
    disconnect() {}
    static layoutChanged() {
      for (const callback of FakeResizeObserver.callbacks) callback();
    }
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    FakeResizeObserver.callbacks = [];
    FakeResizeObserver.observed = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("should scroll the thread back to the top when measuring", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, []);
    thread.scrollTop = 150;
    createThreadFollower(thread).measure();
    expect(thread.scrollTop).toBe(0);
  });

  it("should glide down to what the scene has revealed", () => {
    // Revealed at 100ms, ending 400px down a 200px thread: target 212.
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "100ms", bottom: 400 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(96);
    expect(thread.scrollTop).toBe(0);
    vi.advanceTimersByTime(16);
    expect(thread.scrollTop).toBeCloseTo(42.4);
    vi.advanceTimersByTime(16);
    expect(thread.scrollTop).toBeCloseTo(76.32);
    vi.advanceTimersByTime(1000);
    expect(thread.scrollTop).toBe(212);
  });

  it("should keep the thread still while everything revealed fits", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "0ms", bottom: 150 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(500);
    expect(thread.scrollTop).toBe(0);
  });

  it("should stop scheduling frames once everything is revealed and in view", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "100ms", bottom: 400 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(2000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should keep running while a reveal is still ahead", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "5000ms", bottom: 400 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(2000);
    expect(thread.scrollTop).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("should not scroll past the end of the thread", () => {
    // Target 212, but only 100px of scroll room.
    const thread = buildThread({ clientHeight: 200, scrollHeight: 300 }, [{ d: "0ms", bottom: 400 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(2000);
    expect(thread.scrollTop).toBe(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should measure every animated kind of element and ignore the rest", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 900 }, [
      { d: "0ms", bottom: 300, className: "fx-stream" },
      { d: "0ms", bottom: 500, className: "fx-working" },
      { d: "0ms", bottom: 800, className: "plain" },
    ]);
    const bubble = document.createElement("div");
    bubble.dataset.fx = "";
    bubble.setAttribute("style", "--d:0ms");
    bubble.getBoundingClientRect = () => ({ bottom: THREAD_TOP + 600 }) as DOMRect;
    thread.append(bubble);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(2000);
    // The data-fx bubble at 600 is the lowest animated element: 600 + 12 - 200.
    expect(thread.scrollTop).toBe(412);
  });

  it("should ignore an animated element without a delay", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 900 }, [{ bottom: 800 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(2000);
    expect(thread.scrollTop).toBe(0);
  });

  it("should take the run's start time into account", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "1000ms", bottom: 400 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    // A run resumed 900ms in: the reveal is due in 100ms, not 1000ms.
    follower.run(performance.now() - 900);
    vi.advanceTimersByTime(96);
    expect(thread.scrollTop).toBe(0);
    vi.advanceTimersByTime(32);
    expect(thread.scrollTop).toBeGreaterThan(0);
  });

  it("should stop following when told to", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "0ms", bottom: 400 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(16);
    const partWay = thread.scrollTop;
    expect(partWay).toBeGreaterThan(0);
    follower.stop();
    vi.advanceTimersByTime(2000);
    expect(thread.scrollTop).toBe(partWay);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should replace a running loop when run again", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "0ms", bottom: 400 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    follower.run(performance.now());
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(16);
    // One glide step, not two.
    expect(thread.scrollTop).toBeCloseTo(42.4);
  });

  it("should tolerate a stop before any run", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, []);
    expect(() => createThreadFollower(thread).stop()).not.toThrow();
  });

  it("should pick a resumed run up from where the thread is", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "0ms", bottom: 400 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    thread.scrollTop = 50;
    follower.run(performance.now());
    vi.advanceTimersByTime(16);
    // One glide step from 50 toward 212, not from the top.
    expect(thread.scrollTop).toBeCloseTo(82.4);
  });

  it("should read the thread's size once per measure, never while running", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "100ms", bottom: 400 }]);
    let sizeReads = 0;
    Object.defineProperties(thread, {
      clientHeight: {
        get: () => {
          sizeReads++;
          return 200;
        },
      },
      scrollHeight: {
        get: () => {
          sizeReads++;
          return 600;
        },
      },
    });
    const follower = createThreadFollower(thread);
    follower.measure();
    expect(sizeReads).toBe(2);
    follower.run(performance.now());
    vi.advanceTimersByTime(2000);
    expect(thread.scrollTop).toBe(212);
    expect(sizeReads).toBe(2);
  });

  it("should watch the thread and each of its children for size changes", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [
      { d: "0ms", bottom: 100 },
      { d: "0ms", bottom: 300 },
    ]);
    createThreadFollower(thread);
    expect(FakeResizeObserver.observed).toEqual([thread, ...thread.children]);
  });

  it("should do nothing on a layout change before the first measure", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "0ms", bottom: 400 }]);
    createThreadFollower(thread);
    expect(() => FakeResizeObserver.layoutChanged()).not.toThrow();
    expect(thread.scrollTop).toBe(0);
  });

  it("should keep its notes when the layout is announced unchanged mid-scroll", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "0ms", bottom: 400 }]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(2000);
    expect(thread.scrollTop).toBe(212);
    // The rects now read 212px higher; the notes must still say 400 from the content top.
    FakeResizeObserver.layoutChanged();
    expect(thread.scrollTop).toBe(212);
  });

  it("should follow the new positions when the content grows during a run", () => {
    const size = { clientHeight: 200, scrollHeight: 600 };
    const part = { d: "5000ms", bottom: 400 };
    const thread = buildThread(size, [part]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(1000);
    // A web font arrives: the text wraps onto more lines and everything below moves down.
    part.bottom = 600;
    size.scrollHeight = 900;
    FakeResizeObserver.layoutChanged();
    vi.advanceTimersByTime(6000);
    // 600 + 12 - 200, not the 212 the first notes would have given.
    expect(thread.scrollTop).toBe(412);
  });

  it("should move a finished run to where the grown content ends", () => {
    const size = { clientHeight: 200, scrollHeight: 600 };
    const part = { d: "0ms", bottom: 400 };
    const thread = buildThread(size, [part]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(2000);
    expect(thread.scrollTop).toBe(212);
    expect(vi.getTimerCount()).toBe(0);
    part.bottom = 430;
    size.scrollHeight = 630;
    FakeResizeObserver.layoutChanged();
    expect(thread.scrollTop).toBe(242);
  });

  it("should not move a run the host stopped when the layout changes", () => {
    const size = { clientHeight: 200, scrollHeight: 600 };
    const part = { d: "0ms", bottom: 400 };
    const thread = buildThread(size, [part]);
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    vi.advanceTimersByTime(16);
    follower.stop();
    const partWay = thread.scrollTop;
    part.bottom = 430;
    size.scrollHeight = 630;
    FakeResizeObserver.layoutChanged();
    expect(thread.scrollTop).toBe(partWay);
  });

  it("should not read the thread's scroll position while running", () => {
    const thread = buildThread({ clientHeight: 200, scrollHeight: 600 }, [{ d: "0ms", bottom: 400 }]);
    let position = 0;
    let positionReads = 0;
    Object.defineProperty(thread, "scrollTop", {
      get: () => {
        positionReads++;
        return position;
      },
      set: (value: number) => {
        position = value;
      },
    });
    const follower = createThreadFollower(thread);
    follower.measure();
    follower.run(performance.now());
    const readsAtStart = positionReads;
    vi.advanceTimersByTime(2000);
    expect(position).toBe(212);
    expect(positionReads).toBe(readsAtStart);
  });
});
