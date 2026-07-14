// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRotatingPlaceholder } from "../rotating-placeholder";

// Spec: the placeholder starts as the plain prompt, and every 10s fades out
// for 100ms, then shows the next tip (mentions, then skills, then wraps).
// Disabled (existing chats) = plain prompt.
const PLAIN_PROMPT = "Write a message...";
const MENTION_TIP = "Type @ to mention accounts, payees, tags";
const SKILL_TIP = "Type / to use a skill";
const ROTATE_MS = 10_000;
const SWAP_MS = 100;

describe("useRotatingPlaceholder()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderRotating = (enabled: boolean) =>
    renderHook(({ enabled }) => useRotatingPlaceholder(enabled), { initialProps: { enabled } });

  /** One full rotation: wait for the interval, then let the fade-out finish.
   *  Split into two act() calls because the swap timeout is only scheduled
   *  once React flushes the isSwapping effect. */
  const rotateOnce = () => {
    act(() => vi.advanceTimersByTime(ROTATE_MS));
    act(() => vi.advanceTimersByTime(SWAP_MS));
  };

  describe("when enabled", () => {
    it("should show the plain prompt and not be swapping initially", () => {
      const { result } = renderRotating(true);
      expect(result.current.placeholder).toBe(PLAIN_PROMPT);
      expect(result.current.isSwapping).toBe(false);
    });

    it("should not start swapping at 9999ms (just before the rotation interval)", () => {
      const { result } = renderRotating(true);
      act(() => vi.advanceTimersByTime(ROTATE_MS - 1));
      expect(result.current.placeholder).toBe(PLAIN_PROMPT);
      expect(result.current.isSwapping).toBe(false);
    });

    it("should start swapping when the 10s rotation interval elapses", () => {
      const { result } = renderRotating(true);
      act(() => vi.advanceTimersByTime(ROTATE_MS));
      expect(result.current.isSwapping).toBe(true);
    });

    it("should keep the current text while the 100ms fade-out is still running", () => {
      const { result } = renderRotating(true);
      act(() => vi.advanceTimersByTime(ROTATE_MS));
      act(() => vi.advanceTimersByTime(SWAP_MS - 1));
      expect(result.current.placeholder).toBe(PLAIN_PROMPT);
      expect(result.current.isSwapping).toBe(true);
    });

    it("should show the mention tip and stop swapping when the fade-out completes", () => {
      const { result } = renderRotating(true);
      rotateOnce();
      expect(result.current.placeholder).toBe(MENTION_TIP);
      expect(result.current.isSwapping).toBe(false);
    });

    it("should show the skill tip after the mention tip", () => {
      const { result } = renderRotating(true);
      rotateOnce();
      rotateOnce();
      expect(result.current.placeholder).toBe(SKILL_TIP);
      expect(result.current.isSwapping).toBe(false);
    });

    it("should wrap back to the plain prompt after the last tip", () => {
      const { result } = renderRotating(true);
      rotateOnce();
      rotateOnce();
      rotateOnce();
      expect(result.current.placeholder).toBe(PLAIN_PROMPT);
      expect(result.current.isSwapping).toBe(false);
    });

    it("should cycle through the tips again after wrapping", () => {
      const { result } = renderRotating(true);
      rotateOnce();
      rotateOnce();
      rotateOnce();
      rotateOnce();
      expect(result.current.placeholder).toBe(MENTION_TIP);
    });
  });

  describe("when disabled", () => {
    it("should show the plain prompt initially", () => {
      const { result } = renderRotating(false);
      expect(result.current.placeholder).toBe(PLAIN_PROMPT);
      expect(result.current.isSwapping).toBe(false);
    });

    it("should never rotate, even after many intervals", () => {
      const { result } = renderRotating(false);
      act(() => vi.advanceTimersByTime(ROTATE_MS * 10));
      expect(result.current.placeholder).toBe(PLAIN_PROMPT);
      expect(result.current.isSwapping).toBe(false);
    });
  });

  describe("when toggling enabled", () => {
    it("should reset to the plain prompt when disabled while showing a tip", () => {
      const { result, rerender } = renderRotating(true);
      rotateOnce();
      expect(result.current.placeholder).toBe(MENTION_TIP);

      rerender({ enabled: false });
      expect(result.current.placeholder).toBe(PLAIN_PROMPT);
      expect(result.current.isSwapping).toBe(false);
    });

    it("should cancel an in-flight swap when disabled mid-fade-out", () => {
      const { result, rerender } = renderRotating(true);
      act(() => vi.advanceTimersByTime(ROTATE_MS));
      expect(result.current.isSwapping).toBe(true);

      rerender({ enabled: false });
      act(() => vi.advanceTimersByTime(ROTATE_MS));
      expect(result.current.placeholder).toBe(PLAIN_PROMPT);
      expect(result.current.isSwapping).toBe(false);
    });

    it("should restart rotation from the plain prompt when re-enabled", () => {
      const { result, rerender } = renderRotating(true);
      rotateOnce();
      rerender({ enabled: false });

      rerender({ enabled: true });
      expect(result.current.placeholder).toBe(PLAIN_PROMPT);
      rotateOnce();
      expect(result.current.placeholder).toBe(MENTION_TIP);
    });
  });
});
