// Integration: the ledger IPC handlers over a REAL filesystem and the REAL
// hledger binary (a temp ACCOUNTANT24_HOME via makeTmpWorkspace, hledger
// resolved from PATH since the vendored bin dir doesn't exist here). Only
// the Electron IPC layer is faked. The journal mirrors a real user: two
// holdings bought with costs, one purchase priced in a foreign commodity,
// declared market prices toward the base.

import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Investments, NetWorth } from "../../shared/types";
import { makeTmpWorkspace } from "./tmpWorkspace";

type Handler = (event: unknown, payload?: unknown) => unknown;
const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => h.handlers.set(channel, fn) },
  // env.ts resolves resourceDir() via app paths; pointing it at a
  // nonexistent app makes binDir() resolve to a missing dir, so the module
  // falls back to the system `hledger` on PATH.
  app: { isPackaged: false, getAppPath: () => "/nonexistent-app" },
}));

const ws = makeTmpWorkspace();

/** Fresh module + handler registration against the current temp workspace. */
async function load() {
  vi.resetModules();
  h.handlers.clear();
  const mod = await import("../ledger");
  mod.registerLedgerIpc();
  return mod;
}

/** Invoke a registered ledger handler. */
function invoke<T>(channel: string): Promise<T> {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null) as Promise<T>;
}

function seedJournal(): void {
  mkdirSync(ws.path("ledger"), { recursive: true });
  writeFileSync(
    ws.path("ledger", "main.journal"),
    [
      "2025-01-10 Buy SXR8",
      '    assets:brokerage      10 "SXR8" @ 200.00 EUR',
      "    assets:bank:checking",
      "",
      "2025-02-10 Buy AAPL",
      '    assets:brokerage      5 "AAPL" @ 180.00 USD',
      "    assets:bank:checking",
      "",
      "2025-03-01 Salary",
      "    assets:bank:checking  3000 EUR",
      "    income:salary",
      "",
      'P 2025-03-15 "SXR8" 250.00 EUR',
      'P 2025-03-15 "AAPL" 190.00 EUR',
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  ws.setup();
});
afterEach(() => {
  ws.cleanup();
});

describe("ledger net worth over a real journal", () => {
  it("should return an empty sheet when the workspace has no journal yet", async () => {
    await load();
    expect(await invoke<NetWorth>("ledger_net_worth")).toEqual({
      sections: [],
      net: { amounts: [], value: [] },
      baseCommodity: null,
      investments: { rows: [], totalMarketValue: [], totalCostBasis: [] },
    });
  });

  it("should report holdings with market value, cost basis, and P&L from the real hledger", async () => {
    await load();
    seedJournal();
    const sheet = await invoke<NetWorth>("ledger_net_worth");

    // Base resolves from the declared prices: EUR.
    expect(sheet.baseCommodity).toBe("EUR");

    // SXR8: 10 units at 200 EUR cost, valued at the declared 250 EUR price.
    // hledger styles the integer share count at precision 0.
    const sxr8 = sheet.investments.rows.find((r) => r.commodity === "SXR8");
    expect(sxr8).toEqual({
      commodity: "SXR8",
      quantity: { quantity: 10, commodity: "SXR8", precision: 0 },
      price: { quantity: 250, commodity: "EUR", precision: 2 },
      marketValue: { quantity: 2500, commodity: "EUR", precision: 2 },
      costBasis: { quantity: 2000, commodity: "EUR", precision: 2 },
      unrealizedPnl: { quantity: 500, commodity: "EUR", precision: 2 },
    });

    // AAPL: bought in USD, so the cost can't convert to EUR — value only.
    const aapl = sheet.investments.rows.find((r) => r.commodity === "AAPL");
    expect(aapl).toMatchObject({
      quantity: { quantity: 5, commodity: "AAPL", precision: 0 },
      price: { quantity: 190, commodity: "EUR", precision: 2 },
      marketValue: { quantity: 950, commodity: "EUR", precision: 2 },
      costBasis: null,
      unrealizedPnl: null,
    });

    // The leftover USD cash is neither priced nor costed toward EUR, so it
    // never appears as a holding.
    expect(sheet.investments.rows.map((r) => r.commodity)).toEqual(["SXR8", "AAPL"]);

    expect(sheet.investments.totalMarketValue).toEqual([{ quantity: 3450, commodity: "EUR", precision: 2 }]);
    expect(sheet.investments.totalCostBasis).toEqual([{ quantity: 2000, commodity: "EUR", precision: 2 }]);

    // The balance sheet still reads as before: assets hold the two positions,
    // and hledger's full price graph values even the leftover USD (via the
    // AAPL cost chain) — the net lands at 50 + 2500 + 950.
    expect(sheet.sections[0]?.name).toBe("Assets");
    expect(sheet.net.value).toEqual([{ quantity: 3500, commodity: "EUR", precision: 2 }]);
  });
});

describe("ledger investments over a real journal", () => {
  it("should return an empty payload when the workspace has no journal yet", async () => {
    await load();
    expect(await invoke<Investments>("ledger_investments")).toEqual({
      baseCommodity: null,
      rows: [],
      totalMarketValue: [],
      totalCostBasis: [],
    });
  });

  it("should serve the same holdings as the Net Worth section, standalone", async () => {
    await load();
    seedJournal();
    const investments = await invoke<Investments>("ledger_investments");

    // Base resolves from the declared prices, like the balance sheet.
    expect(investments.baseCommodity).toBe("EUR");
    expect(investments.rows.map((r) => r.commodity)).toEqual(["SXR8", "AAPL"]);
    expect(investments.rows.find((r) => r.commodity === "SXR8")).toEqual({
      commodity: "SXR8",
      quantity: { quantity: 10, commodity: "SXR8", precision: 0 },
      price: { quantity: 250, commodity: "EUR", precision: 2 },
      marketValue: { quantity: 2500, commodity: "EUR", precision: 2 },
      costBasis: { quantity: 2000, commodity: "EUR", precision: 2 },
      unrealizedPnl: { quantity: 500, commodity: "EUR", precision: 2 },
    });
    expect(investments.totalMarketValue).toEqual([{ quantity: 3450, commodity: "EUR", precision: 2 }]);
    expect(investments.totalCostBasis).toEqual([{ quantity: 2000, commodity: "EUR", precision: 2 }]);
  });
});
