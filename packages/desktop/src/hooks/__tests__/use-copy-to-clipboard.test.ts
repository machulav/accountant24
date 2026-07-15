// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "../use-copy-to-clipboard";

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCopyToClipboard()", () => {
  it("should start with isCopied false", () => {
    const { result } = renderHook(() => useCopyToClipboard());
    expect(result.current.isCopied).toBe(false);
  });

  it("should write the value to the clipboard and flip isCopied true", async () => {
    const { result } = renderHook(() => useCopyToClipboard());
    act(() => result.current.copyToClipboard("hello"));
    expect(writeText).toHaveBeenCalledWith("hello");
    await waitFor(() => expect(result.current.isCopied).toBe(true));
  });

  it("should reset isCopied to false after the copied duration", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopyToClipboard({ copiedDuration: 1000 }));
    await act(async () => {
      result.current.copyToClipboard("hello");
      await Promise.resolve(); // let the writeText promise resolve
    });
    expect(result.current.isCopied).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.isCopied).toBe(false);
  });

  it("should do nothing for an empty value", () => {
    const { result } = renderHook(() => useCopyToClipboard());
    act(() => result.current.copyToClipboard(""));
    expect(writeText).not.toHaveBeenCalled();
    expect(result.current.isCopied).toBe(false);
  });

  it("should stay not-copied when the clipboard write is rejected", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      result.current.copyToClipboard("hello");
      await Promise.resolve();
    });
    expect(result.current.isCopied).toBe(false);
  });
});
