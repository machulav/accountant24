// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook reaches the main process through @/rpc/api; mock that boundary.
const status = vi.hoisted(() => vi.fn());
const onModelsChanged = vi.hoisted(() => vi.fn());
vi.mock("@/rpc/api", () => ({
  authApi: { status },
  agentApi: { onModelsChanged },
}));

import { useHasModels } from "../useProviderStatus";

/** Capture the models-changed callback the hook registers, and its unsubscribe. */
let modelsChangedCb: (() => void) | null;
let unsubscribe: ReturnType<typeof vi.fn>;

beforeEach(() => {
  modelsChangedCb = null;
  unsubscribe = vi.fn();
  onModelsChanged.mockImplementation((cb: () => void) => {
    modelsChangedCb = cb;
    return unsubscribe;
  });
  status.mockResolvedValue({ type: "status", providers: [], availableModels: 0, anyConfigured: false });
});

afterEach(() => cleanup());

const statusWith = (availableModels: number) => ({
  type: "status",
  providers: [],
  availableModels,
  anyConfigured: availableModels > 0,
});

describe("useHasModels()", () => {
  it("should return null while the first status check is in flight", () => {
    status.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useHasModels());
    expect(result.current).toBeNull();
  });

  it("should return true when at least one model is available", async () => {
    status.mockResolvedValue(statusWith(2));
    const { result } = renderHook(() => useHasModels());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("should return false when no model is available", async () => {
    status.mockResolvedValue(statusWith(0));
    const { result } = renderHook(() => useHasModels());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("should re-check when the models-changed event fires", async () => {
    status.mockResolvedValue(statusWith(0));
    const { result } = renderHook(() => useHasModels());
    await waitFor(() => expect(result.current).toBe(false));

    status.mockResolvedValue(statusWith(1));
    await act(async () => {
      modelsChangedCb?.();
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("should unsubscribe from models-changed on unmount", () => {
    const { unmount } = renderHook(() => useHasModels());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("should not throw when the status check rejects", async () => {
    status.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useHasModels());
    // stays null (loading) rather than crashing
    await waitFor(() => expect(result.current).toBeNull());
  });
});
