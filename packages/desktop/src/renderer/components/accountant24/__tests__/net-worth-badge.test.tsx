// @vitest-environment jsdom

// Spec for the sidebar's net worth badge: nothing while the report loads or
// is empty, the compact ~ figure once loaded, and a refresh on the agent's
// running → idle edge. jsdom pins navigator.language to en-US, so the
// compact expectations are deterministic.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// IPC boundary: the badge reads the report over the Electron bridge.
vi.mock("@/rpc/api", () => ({
  ledgerApi: { netWorth: vi.fn() },
}));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ledgerApi } from "@/rpc/api";
import type { NetWorth } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { NetWorthBadge } from "../net-worth-badge";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());
beforeEach(() => {
  vi.mocked(ledgerApi.netWorth).mockReset();
});

/** Real assistant-ui chrome so the badge's `useAuiState` reads an honest
 *  `thread.isRunning`; the prop drives the running → idle refetch edge. */
function Chrome({ children, isRunning = false }: { children: ReactNode; isRunning?: boolean }) {
  const store: ExternalStoreAdapter = {
    messages: [],
    isRunning,
    onNew: async () => {},
    convertMessage: (m: unknown) => m,
  } as unknown as ExternalStoreAdapter;
  const runtime = useExternalStoreRuntime(store);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

const sheet = (net: NetWorth["net"], baseCommodity: NetWorth["baseCommodity"] = null): NetWorth => ({
  sections: [],
  net,
  baseCommodity,
});

const CONVERTED = sheet({
  amounts: [{ quantity: 1408.26, commodity: "UAH", precision: 2 }],
  value: [{ quantity: 333534.3, commodity: "EUR", precision: 2 }],
});

const renderBadge = (isRunning = false) =>
  render(
    <Chrome isRunning={isRunning}>
      <NetWorthBadge />
    </Chrome>,
  );

describe("<NetWorthBadge />", () => {
  it("should render nothing while the report is loading", () => {
    vi.mocked(ledgerApi.netWorth).mockReturnValue(new Promise(() => {}));
    const { container } = renderBadge();
    expect(container).toBeEmptyDOMElement();
  });

  it("should show the compact figure with ~ when the net worth is a converted estimate", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(CONVERTED);
    renderBadge();
    expect(await screen.findByText("~334K EUR")).toBeInTheDocument();
  });

  it("should show the compact figure without ~ when nothing was converted", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(
      sheet({
        amounts: [{ quantity: 2736, commodity: "EUR", precision: 2 }],
        value: [{ quantity: 2736, commodity: "EUR", precision: 2 }],
      }),
    );
    renderBadge();
    expect(await screen.findByText("2.7K EUR")).toBeInTheDocument();
  });

  it("should lead with the base leg and count the rest when the value spans several commodities", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(
      sheet(
        {
          amounts: [
            { quantity: 2050, commodity: "UAH", precision: 2 },
            { quantity: -50, commodity: "USD", precision: 2 },
            { quantity: 2537.5, commodity: "EUR", precision: 2 },
          ],
          // hledger orders legs alphabetically: the EUR base leg is not first.
          value: [
            { quantity: 3033.5, commodity: "EUR", precision: 2 },
            { quantity: 2050, commodity: "UAH", precision: 2 },
            { quantity: -50, commodity: "USD", precision: 2 },
          ],
        },
        "EUR",
      ),
    );
    renderBadge();
    expect(await screen.findByText("~3K EUR +2")).toBeInTheDocument();
  });

  it("should lead with the first leg when no base commodity is resolved", async () => {
    const amounts = [
      { quantity: 1200, commodity: "EUR", precision: 2 },
      { quantity: 5000, commodity: "UAH", precision: 2 },
    ];
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(sheet({ amounts, value: amounts }));
    renderBadge();
    expect(await screen.findByText("1.2K EUR +1")).toBeInTheDocument();
  });

  it("should render nothing when the report has no value (empty journal)", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(sheet({ amounts: [], value: [] }));
    const { container } = renderBadge();
    await waitFor(() => expect(ledgerApi.netWorth).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("should refetch and update the figure when the agent turn finishes", async () => {
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(CONVERTED);
    const { rerender } = renderBadge(true);
    expect(await screen.findByText("~334K EUR")).toBeInTheDocument();

    // The finished turn changed the ledger: the badge must show the new figure.
    vi.mocked(ledgerApi.netWorth).mockResolvedValue(
      sheet({
        amounts: [{ quantity: 1500.26, commodity: "UAH", precision: 2 }],
        value: [{ quantity: 400123.4, commodity: "EUR", precision: 2 }],
      }),
    );
    rerender(
      <Chrome isRunning={false}>
        <NetWorthBadge />
      </Chrome>,
    );
    expect(await screen.findByText("~400K EUR")).toBeInTheDocument();
    expect(ledgerApi.netWorth).toHaveBeenCalledTimes(2);
  });
});
