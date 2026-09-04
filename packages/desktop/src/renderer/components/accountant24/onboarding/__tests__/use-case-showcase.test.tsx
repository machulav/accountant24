// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USE_CASE_ROTATE_MS, USE_CASES, UseCaseShowcase, useCycledIndex } from "../use-case-showcase";

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("useCycledIndex()", () => {
  it("should start at 0", () => {
    const { result } = renderHook(() => useCycledIndex(3, 1000));
    expect(result.current).toBe(0);
  });

  it("should advance by one after each interval", () => {
    const { result } = renderHook(() => useCycledIndex(3, 1000));
    advance(1000);
    expect(result.current).toBe(1);
    advance(1000);
    expect(result.current).toBe(2);
  });

  it("should not advance before the interval has elapsed", () => {
    const { result } = renderHook(() => useCycledIndex(3, 1000));
    advance(999);
    expect(result.current).toBe(0);
  });

  it("should wrap around to 0 after the last item", () => {
    const { result } = renderHook(() => useCycledIndex(3, 1000));
    advance(3000);
    expect(result.current).toBe(0);
  });

  it("should not schedule anything with a single item", () => {
    renderHook(() => useCycledIndex(1, 1000));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should not schedule anything with no items", () => {
    const { result } = renderHook(() => useCycledIndex(0, 1000));
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current).toBe(0);
  });

  it("should clear the interval on unmount", () => {
    const { unmount } = renderHook(() => useCycledIndex(3, 1000));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("UseCaseShowcase", () => {
  it("should show the first exchange at first", () => {
    render(<UseCaseShowcase />);
    expect(screen.getByText(USE_CASES[0]?.prompt ?? "")).toBeInTheDocument();
    expect(screen.getByText(USE_CASES[0]?.reply ?? "")).toBeInTheDocument();
  });

  it("should show one exchange at a time", () => {
    render(<UseCaseShowcase />);
    expect(screen.queryByText(USE_CASES[1]?.prompt ?? "")).not.toBeInTheDocument();
  });

  it("should move to the next exchange after the rotation interval", () => {
    render(<UseCaseShowcase />);
    advance(USE_CASE_ROTATE_MS);
    expect(screen.getByText(USE_CASES[1]?.prompt ?? "")).toBeInTheDocument();
    expect(screen.queryByText(USE_CASES[0]?.prompt ?? "")).not.toBeInTheDocument();
  });

  it("should come back to the first exchange after the last one", () => {
    render(<UseCaseShowcase />);
    advance(USE_CASE_ROTATE_MS * USE_CASES.length);
    expect(screen.getByText(USE_CASES[0]?.prompt ?? "")).toBeInTheDocument();
  });

  it("should be hidden from assistive technology (decoration only)", () => {
    const { container } = render(<UseCaseShowcase />);
    expect(container.querySelector("[aria-hidden]")).toBeInTheDocument();
  });

  it("should stop rotating on unmount", () => {
    const { unmount } = render(<UseCaseShowcase />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
