// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The updater IPC bridge is the faked boundary. `pending()` is the mount-time
// state query; `onDownloaded(cb)` subscribes to the server→renderer push and
// returns an unsubscribe. We capture the subscribed callback so tests can fire
// a push on demand.
const pending = vi.fn<() => Promise<string | null>>();
const unsubscribe = vi.fn();
let pushDownloaded: ((version: string) => void) | undefined;

vi.mock("@/rpc/api", () => ({
  updateApi: {
    pending: () => pending(),
    install: vi.fn(),
    onDownloaded: (cb: (version: string) => void) => {
      pushDownloaded = cb;
      return unsubscribe;
    },
  },
}));

import { useUpdateStatus } from "../use-update-status";

/** A promise whose resolution the test controls, to order pending() vs a push. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  pending.mockReset();
  unsubscribe.mockClear();
  pushDownloaded = undefined;
});

afterEach(() => {
  cleanup();
});

describe("useUpdateStatus()", () => {
  it("should return null before pending() resolves", () => {
    pending.mockReturnValue(deferred<string | null>().promise);
    const { result } = renderHook(() => useUpdateStatus());
    expect(result.current).toBeNull();
  });

  it("should surface the staged version reported by pending() on mount", async () => {
    pending.mockResolvedValue("1.2.3");
    const { result } = renderHook(() => useUpdateStatus());
    await waitFor(() => expect(result.current).toBe("1.2.3"));
  });

  it("should stay null when no update is pending", async () => {
    pending.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdateStatus());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBeNull();
  });

  it("should update to the pushed version when a download completes after mount", async () => {
    pending.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdateStatus());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => pushDownloaded?.("2.0.0"));
    expect(result.current).toBe("2.0.0");
  });

  it("should keep the pushed version when a stale pending() resolves afterward", async () => {
    // Push lands while pending() is still in flight; the older pending() result
    // must not overwrite the fresher pushed version.
    const late = deferred<string | null>();
    pending.mockReturnValue(late.promise);
    const { result } = renderHook(() => useUpdateStatus());

    act(() => pushDownloaded?.("2.0.0"));
    expect(result.current).toBe("2.0.0");

    await act(async () => {
      late.resolve(null);
      await late.promise;
    });
    expect(result.current).toBe("2.0.0");
  });

  it("should unsubscribe from the push on unmount", async () => {
    pending.mockResolvedValue(null);
    const { unmount } = renderHook(() => useUpdateStatus());
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("should ignore a pending() resolution that arrives after unmount", async () => {
    const late = deferred<string | null>();
    pending.mockReturnValue(late.promise);
    const { unmount } = renderHook(() => useUpdateStatus());
    unmount();
    // The disposed guard makes this a no-op rather than a state update on an
    // unmounted hook; it must not throw.
    await expect(
      act(async () => {
        late.resolve("3.0.0");
        await late.promise;
      }),
    ).resolves.toBeUndefined();
  });
});
