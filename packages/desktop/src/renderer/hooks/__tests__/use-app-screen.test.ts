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

import { useAppScreen } from "../use-app-screen";

let modelsChangedCb: (() => void) | null;
let unsubscribe: ReturnType<typeof vi.fn>;

beforeEach(() => {
  modelsChangedCb = null;
  unsubscribe = vi.fn();
  onModelsChanged.mockImplementation((cb: () => void) => {
    modelsChangedCb = cb;
    return unsubscribe;
  });
});

afterEach(() => cleanup());

const statusWith = (availableModels: number) => ({
  type: "status",
  providers: [],
  availableModels,
  anyConfigured: availableModels > 0,
});

const modelsChanged = async (availableModels: number) => {
  status.mockResolvedValue(statusWith(availableModels));
  await act(async () => {
    modelsChangedCb?.();
  });
};

describe("useAppScreen()", () => {
  it("should be loading while the first status check is in flight", () => {
    status.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAppScreen());
    expect(result.current.screen).toBe("loading");
  });

  it("should open onboarding when no model is available", async () => {
    status.mockResolvedValue(statusWith(0));
    const { result } = renderHook(() => useAppScreen());
    await waitFor(() => expect(result.current.screen).toBe("onboarding"));
  });

  it("should open the chat when a model is available", async () => {
    status.mockResolvedValue(statusWith(3));
    const { result } = renderHook(() => useAppScreen());
    await waitFor(() => expect(result.current.screen).toBe("chat"));
  });

  it("should stay in onboarding when a model appears (the wizard ends itself)", async () => {
    status.mockResolvedValue(statusWith(0));
    const { result } = renderHook(() => useAppScreen());
    await waitFor(() => expect(result.current.screen).toBe("onboarding"));

    await modelsChanged(1);
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
    expect(result.current.screen).toBe("onboarding");
  });

  it("should switch to the chat when onboarding is finished", async () => {
    status.mockResolvedValue(statusWith(0));
    const { result } = renderHook(() => useAppScreen());
    await waitFor(() => expect(result.current.screen).toBe("onboarding"));

    act(() => result.current.finishOnboarding());
    expect(result.current.screen).toBe("chat");
  });

  it("should return to onboarding when every model is removed in the chat", async () => {
    status.mockResolvedValue(statusWith(1));
    const { result } = renderHook(() => useAppScreen());
    await waitFor(() => expect(result.current.screen).toBe("chat"));

    await modelsChanged(0);
    await waitFor(() => expect(result.current.screen).toBe("onboarding"));
  });

  it("should stay in the chat when a re-check still finds models", async () => {
    status.mockResolvedValue(statusWith(1));
    const { result } = renderHook(() => useAppScreen());
    await waitFor(() => expect(result.current.screen).toBe("chat"));

    await modelsChanged(2);
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
    expect(result.current.screen).toBe("chat");
  });

  it("should keep the same finishOnboarding function across renders", async () => {
    status.mockResolvedValue(statusWith(0));
    const { result, rerender } = renderHook(() => useAppScreen());
    await waitFor(() => expect(result.current.screen).toBe("onboarding"));
    const first = result.current.finishOnboarding;
    rerender();
    expect(result.current.finishOnboarding).toBe(first);
  });

  it("should unsubscribe from models-changed on unmount", () => {
    status.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useAppScreen());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
