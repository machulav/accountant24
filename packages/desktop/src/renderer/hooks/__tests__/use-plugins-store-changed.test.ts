// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IPC boundary: the hook only ever talks to pluginsApi.onEvent.
const h = vi.hoisted(() => ({
  listeners: [] as ((event: { type: string; message?: string }) => void)[],
  unsub: vi.fn(),
  onEvent: vi.fn(),
}));

vi.mock("@/rpc/api", () => ({ pluginsApi: { onEvent: h.onEvent } }));

import { usePluginsStoreChanged } from "../use-plugins-store-changed";

/** The default subscription: collect the callback, hand back an unsubscribe. */
const subscribes = () =>
  h.onEvent.mockImplementation(async (cb: (event: { type: string; message?: string }) => void) => {
    h.listeners.push(cb);
    return h.unsub;
  });

const emit = (event: { type: string; message?: string }) => {
  for (const cb of h.listeners) cb(event);
};

beforeEach(() => {
  h.listeners = [];
  h.unsub.mockClear();
  h.onEvent.mockReset();
  subscribes();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePluginsStoreChanged()", () => {
  it("should run the callback when the store changed", async () => {
    const onChanged = vi.fn();
    renderHook(() => usePluginsStoreChanged(onChanged));
    await waitFor(() => expect(h.listeners).toHaveLength(1));

    emit({ type: "changed" });

    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("should ignore the progress lines of an install", async () => {
    const onChanged = vi.fn();
    renderHook(() => usePluginsStoreChanged(onChanged));
    await waitFor(() => expect(h.listeners).toHaveLength(1));

    emit({ type: "progress", message: "Downloading acme/pdf-tools…" });

    expect(onChanged).not.toHaveBeenCalled();
  });

  it("should unsubscribe on unmount", async () => {
    const { unmount } = renderHook(() => usePluginsStoreChanged(vi.fn()));
    await waitFor(() => expect(h.listeners).toHaveLength(1));

    unmount();

    expect(h.unsub).toHaveBeenCalledTimes(1);
  });

  it("should drop a subscription that lands after unmount", async () => {
    let land: (off: () => void) => void = () => {};
    h.onEvent.mockImplementation(() => new Promise((resolve) => (land = resolve)));
    const { unmount } = renderHook(() => usePluginsStoreChanged(vi.fn()));
    unmount();

    land(h.unsub);

    await waitFor(() => expect(h.unsub).toHaveBeenCalledTimes(1));
  });

  it("should stay quiet when the subscription fails", async () => {
    h.onEvent.mockRejectedValue(new Error("no bridge"));
    const onChanged = vi.fn();

    const { unmount } = renderHook(() => usePluginsStoreChanged(onChanged));
    unmount();

    expect(onChanged).not.toHaveBeenCalled();
  });
});
