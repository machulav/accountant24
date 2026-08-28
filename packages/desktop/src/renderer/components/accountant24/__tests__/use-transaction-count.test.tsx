// @vitest-environment jsdom

// Spec for the transaction count feed behind the prompt ideas: unknown until
// the first answer, 0 on failure, refetched when a turn finishes.
import { afterEach, describe, expect, it, vi } from "vitest";

// IPC boundary: the count comes over the Electron bridge.
vi.mock("@/rpc/api", () => ({ ledgerApi: { transactionCount: vi.fn() } }));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ledgerApi } from "@/rpc/api";
import { useTransactionCount } from "../use-transaction-count";

afterEach(() => cleanup());

/** A real external-store runtime; `isRunning` drives the idle-edge refresh. */
function Chrome({ children, isRunning = false }: { children: ReactNode; isRunning?: boolean }) {
  const store = {
    messages: [],
    isRunning,
    onNew: async () => {},
    convertMessage: (m: unknown) => m,
  } as unknown as ExternalStoreAdapter;
  const runtime = useExternalStoreRuntime(store);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

const Probe = () => {
  const count = useTransactionCount();
  return <output>{count === null ? "unknown" : String(count)}</output>;
};

const renderProbe = (isRunning = false) =>
  render(
    <Chrome isRunning={isRunning}>
      <Probe />
    </Chrome>,
  );

describe("useTransactionCount()", () => {
  it("should fetch the count once on mount and expose it", async () => {
    vi.mocked(ledgerApi.transactionCount).mockResolvedValue(12);
    renderProbe();
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(ledgerApi.transactionCount).toHaveBeenCalledTimes(1);
  });

  it("should be unknown (null) until the fetch answers", async () => {
    let resolve: (n: number) => void = () => {};
    vi.mocked(ledgerApi.transactionCount).mockReturnValue(new Promise<number>((r) => (resolve = r)));
    renderProbe();
    expect(screen.getByText("unknown")).toBeInTheDocument();

    await act(async () => resolve(3));
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("should count a failed fetch as 0", async () => {
    vi.mocked(ledgerApi.transactionCount).mockRejectedValue(new Error("bridge down"));
    renderProbe();
    expect(await screen.findByText("0")).toBeInTheDocument();
  });

  it("should ignore an answer that arrives after unmount", async () => {
    let resolve: (n: number) => void = () => {};
    vi.mocked(ledgerApi.transactionCount).mockReturnValue(new Promise<number>((r) => (resolve = r)));
    const { unmount } = renderProbe();
    unmount();
    await act(async () => resolve(3));
    expect(screen.queryByText("3")).toBeNull();
  });

  it("should refetch when a turn finishes", async () => {
    vi.mocked(ledgerApi.transactionCount).mockResolvedValueOnce(1).mockResolvedValueOnce(20);
    const { rerender } = renderProbe();
    expect(await screen.findByText("1")).toBeInTheDocument();

    rerender(
      <Chrome isRunning>
        <Probe />
      </Chrome>,
    );
    rerender(
      <Chrome isRunning={false}>
        <Probe />
      </Chrome>,
    );
    expect(await screen.findByText("20")).toBeInTheDocument();
    expect(ledgerApi.transactionCount).toHaveBeenCalledTimes(2);
  });
});
