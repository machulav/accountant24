// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardData } from "../../rpc/types";

// The ledger IPC bridge is the faked boundary. The hook keeps a module-level
// cache, so each test re-imports a fresh module via vi.resetModules().
const dashboard = vi.fn<() => Promise<DashboardData>>();

vi.mock("@/rpc/api", () => ({
  ledgerApi: {
    mentions: vi.fn(),
    dashboard: () => dashboard(),
  },
}));

function makeData(overrides?: Partial<DashboardData>): DashboardData {
  return {
    netWorth: [{ amount: 5000, currency: "EUR", change: 100 }],
    incomeThisMonth: [{ amount: 3000, currency: "EUR" }],
    spendThisMonth: [{ amount: 1200, currency: "EUR" }],
    topCategories: [{ name: "food", amount: 500, currency: "EUR" }],
    netWorthSeries: [],
    incomeExpenseSeries: [],
    dominantCurrency: "EUR",
    otherCurrencies: [],
    hasTransactions: true,
    error: null,
    ...overrides,
  };
}

/** A promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function importHook() {
  const mod = await import("../use-dashboard-data");
  return mod.useDashboardData;
}

beforeEach(() => {
  vi.resetModules();
  dashboard.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useDashboardData()", () => {
  it("should report loading with no data before the first fetch resolves", async () => {
    dashboard.mockReturnValue(deferred<DashboardData>().promise);
    const useDashboardData = await importHook();
    const { result } = renderHook(() => useDashboardData());
    expect(result.current).toEqual({ data: null, loading: true });
  });

  it("should return the fetched data and stop loading", async () => {
    const data = makeData();
    dashboard.mockResolvedValue(data);
    const useDashboardData = await importHook();
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current).toEqual({ data, loading: false }));
  });

  it("should stop loading and keep data null when the fetch fails", async () => {
    dashboard.mockRejectedValue(new Error("ipc failed"));
    const useDashboardData = await importHook();
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it("should serve cached data instantly on remount while refetching", async () => {
    const first = makeData();
    dashboard.mockResolvedValue(first);
    const useDashboardData = await importHook();
    const mounted = renderHook(() => useDashboardData());
    await waitFor(() => expect(mounted.result.current.data).toEqual(first));
    mounted.unmount();

    const late = deferred<DashboardData>();
    dashboard.mockReturnValue(late.promise);
    const remounted = renderHook(() => useDashboardData());
    expect(remounted.result.current).toEqual({ data: first, loading: false });

    const second = makeData({ netWorth: [{ amount: 6000, currency: "EUR", change: 1000 }] });
    await act(async () => {
      late.resolve(second);
      await late.promise;
    });
    expect(remounted.result.current.data).toEqual(second);
  });

  it("should keep cached data when a background refetch fails", async () => {
    const first = makeData();
    dashboard.mockResolvedValue(first);
    const useDashboardData = await importHook();
    const mounted = renderHook(() => useDashboardData());
    await waitFor(() => expect(mounted.result.current.data).toEqual(first));
    mounted.unmount();

    dashboard.mockRejectedValue(new Error("ipc failed"));
    const remounted = renderHook(() => useDashboardData());
    await act(async () => {
      await Promise.resolve();
    });
    expect(remounted.result.current).toEqual({ data: first, loading: false });
  });

  it("should ignore a resolution that arrives after unmount", async () => {
    const late = deferred<DashboardData>();
    dashboard.mockReturnValue(late.promise);
    const useDashboardData = await importHook();
    const { unmount } = renderHook(() => useDashboardData());
    unmount();
    await expect(
      act(async () => {
        late.resolve(makeData());
        await late.promise;
      }),
    ).resolves.toBeUndefined();
  });
});
