import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerTransaction, NetWorth } from "../../shared/types";

// ledger.ts answers the composer's @-mention query (`hledger
// accounts|payees|tags`), the Net Worth view's report query (`hledger bs`),
// and the Transactions view's register query (`hledger print`) against the
// workspace journal. child_process (the real hledger binary), node:fs,
// Electron IPC, and env paths are the faked boundaries; the line-shaping,
// the JSON parse, and the failure contracts run for real (empty on any
// failure — except the register, which rejects when the journal exists but
// cannot be read).
type Handler = (event: unknown, payload?: unknown) => unknown;
type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  execFile: vi.fn(),
  existsSync: vi.fn<(p: string) => boolean>(() => false),
}));

vi.mock("node:child_process", () => ({ execFile: h.execFile }));
vi.mock("node:fs", () => ({ existsSync: (p: string) => h.existsSync(p) }));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
}));
vi.mock("../env", () => ({
  workspaceDir: () => "/ws",
  binDir: () => "/vendored/bin",
  mainJournalPath: () => "/ws/ledger/main.journal",
  agentEnv: () => ({ PATH: "/vendored/bin", ACCOUNTANT24_WORKSPACE: "/ws" }),
}));

/** A canned hledger result per subcommand: an array of stdout lines, or an
 *  Error to simulate a failure (missing binary, no journal, parse error). */
type Response = string[] | Error;

/** Program execFile so each `hledger <sub>` returns the given canned result.
 *  Variants are keyed by their flags: "bs" (native holdings), "bs:V" (at
 *  market value, `-X` or `-V`), "prices" (declared P directives only),
 *  "prices:inferred" (`--infer-market-prices` fallback probe). A sub without
 *  a canned result returns empty output. */
function stubHledger(bySub: Record<string, Response>) {
  h.execFile.mockImplementation((_bin: string, args: string[], _opts: unknown, cb: ExecCb) => {
    let sub = args[0] as string;
    // The -X/-V check must win: the valued bs run also carries
    // --infer-market-prices and must stay keyed "bs:V".
    if (args.includes("-X") || args.includes("-V")) sub += ":V";
    else if (args.includes("--infer-market-prices")) sub += ":inferred";
    const r = bySub[sub];
    if (r instanceof Error) {
      cb(r, "", "boom");
      return;
    }
    cb(null, (r ?? []).join("\n"), "");
  });
}

async function invoke<T>(channel: string): Promise<T> {
  const mod = await import("../ledger");
  mod.registerLedgerIpc();
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return (await handler(null)) as T;
}

const mentions = () => invoke<{ accounts: string[]; payees: string[]; tags: string[] }>("ledger_mentions");
const netWorth = () => invoke<NetWorth>("ledger_net_worth");
const transactions = () => invoke<LedgerTransaction[]>("ledger_transactions");

beforeEach(() => {
  h.handlers.clear();
  h.execFile.mockReset();
  h.existsSync.mockReset();
  h.existsSync.mockReturnValue(false);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ledger_mentions", () => {
  it("should return the accounts, payees, and tags lists together", async () => {
    stubHledger({
      accounts: ["assets", "expenses"],
      payees: ["ACME"],
      tags: ["category"],
    });
    const result = await mentions();
    expect(result).toEqual({
      accounts: ["assets", "expenses"],
      payees: ["ACME"],
      tags: ["category"],
    });
  });

  it("should sort each list case-insensitively (not by ASCII code point)", async () => {
    // ASCII order would put "Bravo" (B=66) before "alpha" (a=97); a
    // case-insensitive sort must place "alpha" first.
    stubHledger({
      accounts: ["Bravo", "alpha"],
      payees: ["Zeta", "alpha", "Beta"],
      tags: [],
    });
    const result = await mentions();
    expect(result.accounts).toEqual(["alpha", "Bravo"]);
    expect(result.payees).toEqual(["alpha", "Beta", "Zeta"]);
  });

  it("should trim surrounding whitespace and drop blank lines", async () => {
    stubHledger({
      accounts: ["  income  ", "", "   ", "assets"],
      payees: [],
      tags: [],
    });
    const result = await mentions();
    expect(result.accounts).toEqual(["assets", "income"]);
  });

  it("should return [] for accounts when the accounts query fails", async () => {
    stubHledger({
      accounts: new Error("hledger: no journal"),
      payees: ["ACME"],
      tags: ["category"],
    });
    const result = await mentions();
    expect(result.accounts).toEqual([]);
    expect(result.payees).toEqual(["ACME"]);
    expect(result.tags).toEqual(["category"]);
  });

  it("should return [] for payees when the payees query fails", async () => {
    stubHledger({
      accounts: ["assets"],
      payees: new Error("hledger: boom"),
      tags: ["category"],
    });
    const result = await mentions();
    expect(result.accounts).toEqual(["assets"]);
    expect(result.payees).toEqual([]);
    expect(result.tags).toEqual(["category"]);
  });

  it("should return [] for tags when the tags query fails", async () => {
    stubHledger({
      accounts: ["assets"],
      payees: ["ACME"],
      tags: new Error("hledger: boom"),
    });
    const result = await mentions();
    expect(result.tags).toEqual([]);
    expect(result.accounts).toEqual(["assets"]);
    expect(result.payees).toEqual(["ACME"]);
  });

  it("should return all-empty lists when hledger is missing entirely", async () => {
    const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    stubHledger({ accounts: enoent, payees: enoent, tags: enoent });
    const result = await mentions();
    expect(result).toEqual({ accounts: [], payees: [], tags: [] });
  });

  it("should query each subcommand against the workspace journal, in the workspace cwd, with the agent env", async () => {
    stubHledger({ accounts: [], payees: [], tags: [] });
    await mentions();

    const journal = "/ws/ledger/main.journal";
    const subs = h.execFile.mock.calls.map((c) => (c[1] as string[])[0]);
    expect(new Set(subs)).toEqual(new Set(["accounts", "payees", "tags"]));

    for (const call of h.execFile.mock.calls) {
      const args = call[1] as string[];
      const opts = call[2] as { cwd: string; env: unknown; maxBuffer: number };
      expect(args).toEqual([args[0], "-f", journal]);
      expect(opts.cwd).toBe("/ws");
      expect(opts.env).toEqual({ PATH: "/vendored/bin", ACCOUNTANT24_WORKSPACE: "/ws" });
      expect(opts.maxBuffer).toBe(16 * 1024 * 1024);
    }
  });

  it("should run the vendored hledger binary when it exists in binDir", async () => {
    h.existsSync.mockReturnValue(true);
    stubHledger({ accounts: [], payees: [], tags: [] });
    await mentions();
    for (const call of h.execFile.mock.calls) {
      expect(call[0]).toBe("/vendored/bin/hledger");
    }
  });

  it("should fall back to a PATH lookup of `hledger` when the vendored binary is absent", async () => {
    h.existsSync.mockReturnValue(false);
    stubHledger({ accounts: [], payees: [], tags: [] });
    await mentions();
    for (const call of h.execFile.mock.calls) {
      expect(call[0]).toBe("hledger");
    }
  });
});

describe("ledger_net_worth", () => {
  const amt = (commodity: string, floatingPoint: number, decimalPlaces = 2) => ({
    acommodity: commodity,
    aquantity: { decimalMantissa: 0, decimalPlaces, floatingPoint },
    astyle: { asprecision: decimalPlaces },
  });
  const prow = (name: string, amounts: unknown[]) => ({ prrName: name, prrAmounts: [amounts] });
  const report = (subreports: [string, unknown[], unknown[]][], net: unknown[]) => [
    JSON.stringify({
      cbrSubreports: subreports.map(([name, rows, total]) => [
        name,
        { prRows: rows, prTotals: { prrAmounts: [total] } },
        true,
      ]),
      cbrTotals: { prrAmounts: [net] },
    }),
  ];
  const EMPTY_REPORT = report([], []);
  const emptyStubs = { bs: EMPTY_REPORT, "bs:V": EMPTY_REPORT, prices: ["P 2026-07-22 UAH 0.01958 EUR"] };
  const printed = (txns: unknown[]) => [JSON.stringify(txns)];

  // Native run: BTC holding plus a positive (bs sign convention) liability;
  // valued run: everything in EUR.
  const STUBS = {
    bs: report(
      [
        ["Assets", [prow("assets:btc", [amt("BTC", 0.16, 8)])], [amt("BTC", 0.16, 8)]],
        ["Liabilities", [prow("liabilities:card", [amt("EUR", 300)])], [amt("EUR", 300)]],
      ],
      [amt("BTC", 0.16, 8), amt("EUR", -300)],
    ),
    "bs:V": report(
      [
        ["Assets", [prow("assets:btc", [amt("EUR", 9990)])], [amt("EUR", 9990)]],
        ["Liabilities", [prow("liabilities:card", [amt("EUR", 300)])], [amt("EUR", 300)]],
      ],
      [amt("EUR", 9690)],
    ),
    print: printed([
      {
        tdate: "2026-07-05",
        tpostings: [{ paccount: "assets:btc", pdate: null, pbalanceassertion: { baamount: amt("BTC", 0.16, 8) } }],
      },
    ]),
    // The latest price in the stub journal targets EUR: the derived base.
    prices: ["P 2026-07-10 USD 0.87 EUR", "P 2026-07-22 UAH 0.01958 EUR"],
  };

  it("should pair the sections and net of the native and valued bs runs", async () => {
    stubHledger(STUBS);
    expect(await netWorth()).toEqual({
      sections: [
        {
          name: "Assets",
          rows: [
            {
              name: "assets:btc",
              amounts: [{ quantity: 0.16, commodity: "BTC", precision: 8 }],
              value: [{ quantity: 9990, commodity: "EUR", precision: 2 }],
              assertedOn: "2026-07-05",
              assertedAmount: { quantity: 0.16, commodity: "BTC", precision: 8 },
            },
          ],
          total: {
            amounts: [{ quantity: 0.16, commodity: "BTC", precision: 8 }],
            value: [{ quantity: 9990, commodity: "EUR", precision: 2 }],
          },
        },
        {
          name: "Liabilities",
          rows: [
            {
              name: "liabilities:card",
              amounts: [{ quantity: 300, commodity: "EUR", precision: 2 }],
              value: [{ quantity: 300, commodity: "EUR", precision: 2 }],
            },
          ],
          total: {
            amounts: [{ quantity: 300, commodity: "EUR", precision: 2 }],
            value: [{ quantity: 300, commodity: "EUR", precision: 2 }],
          },
        },
      ],
      net: {
        amounts: [
          { quantity: 0.16, commodity: "BTC", precision: 8 },
          { quantity: -300, commodity: "EUR", precision: 2 },
        ],
        value: [{ quantity: 9690, commodity: "EUR", precision: 2 }],
      },
      baseCommodity: "EUR",
    });
  });

  it("should run bs natively, then valued toward the base derived from the journal prices, plus print for assertion dates, against the workspace journal in the workspace cwd with the agent env", async () => {
    stubHledger(emptyStubs);
    await netWorth();

    expect(h.execFile.mock.calls).toHaveLength(4);
    const base = ["bs", "-O", "json", "-f", "/ws/ledger/main.journal"];
    const argLists = h.execFile.mock.calls.map((c) => c[1] as string[]);
    expect(argLists).toContainEqual(base);
    expect(argLists).toContainEqual([...base, "-X", "EUR", "--infer-market-prices"]);
    expect(argLists).toContainEqual(["print", "-O", "json", "-f", "/ws/ledger/main.journal"]);
    expect(argLists).toContainEqual(["prices", "-f", "/ws/ledger/main.journal"]);
    // Declared prices exist, so the cost-inferred probe must not run.
    expect(argLists).not.toContainEqual(["prices", "-f", "/ws/ledger/main.journal", "--infer-market-prices"]);
    for (const call of h.execFile.mock.calls) {
      const opts = call[2] as { cwd: string; env: unknown; maxBuffer: number };
      expect(opts.cwd).toBe("/ws");
      expect(opts.env).toEqual({ PATH: "/vendored/bin", ACCOUNTANT24_WORKSPACE: "/ws" });
      expect(opts.maxBuffer).toBe(16 * 1024 * 1024);
    }
  });

  it("should fall back to the cost-inferred base when the journal declares no prices", async () => {
    stubHledger({ ...emptyStubs, prices: [], "prices:inferred": ["P 2026-07-20 WRLD 210.00 EUR"] });
    const sheet = await netWorth();

    expect(h.execFile.mock.calls).toHaveLength(5);
    const argLists = h.execFile.mock.calls.map((c) => c[1] as string[]);
    expect(argLists).toContainEqual(["prices", "-f", "/ws/ledger/main.journal"]);
    expect(argLists).toContainEqual(["prices", "-f", "/ws/ledger/main.journal", "--infer-market-prices"]);
    expect(argLists).toContainEqual([
      "bs",
      "-O",
      "json",
      "-f",
      "/ws/ledger/main.journal",
      "-X",
      "EUR",
      "--infer-market-prices",
    ]);
    expect(sheet.baseCommodity).toBe("EUR");
  });

  it("should fall back to -V when neither declared nor cost-inferred prices exist", async () => {
    stubHledger({ ...emptyStubs, prices: [], "prices:inferred": [] });
    const sheet = await netWorth();
    const argLists = h.execFile.mock.calls.map((c) => c[1] as string[]);
    expect(argLists).toContainEqual(["bs", "-O", "json", "-f", "/ws/ledger/main.journal", "-V"]);
    expect(sheet.baseCommodity).toBeNull();
  });

  it("should graft only the date when the assertion carries no parseable amount", async () => {
    stubHledger({
      ...STUBS,
      print: printed([
        {
          tdate: "2026-07-05",
          tpostings: [{ paccount: "assets:btc", pdate: null, pbalanceassertion: { baamount: {} } }],
        },
      ]),
    });
    const row = (await netWorth()).sections[0]?.rows[0];
    expect(row?.assertedOn).toBe("2026-07-05");
    expect(row?.assertedAmount).toBeUndefined();
  });

  it("should leave rows without assertions untouched when the print run fails", async () => {
    stubHledger({ ...STUBS, print: new Error("boom") });
    const sheet = await netWorth();
    expect(sheet.sections[0]?.rows[0]?.assertedOn).toBeUndefined();
    expect(sheet.sections[0]?.rows[0]?.assertedAmount).toBeUndefined();
  });

  it("should fall back to the raw amounts as the value when the valued run fails", async () => {
    stubHledger({ ...STUBS, "bs:V": new Error("no prices") });
    const sheet = await netWorth();
    expect(sheet.sections[0]?.rows[0]?.value).toEqual([{ quantity: 0.16, commodity: "BTC", precision: 8 }]);
    expect(sheet.net.value).toEqual([
      { quantity: 0.16, commodity: "BTC", precision: 8 },
      { quantity: -300, commodity: "EUR", precision: 2 },
    ]);
    // The base still resolved from the prices probe; only the valuation failed.
    expect(sheet.baseCommodity).toBe("EUR");
  });

  it("should return an empty sheet when hledger fails (no journal yet)", async () => {
    const err = new Error("hledger: no journal");
    stubHledger({ bs: err, "bs:V": err });
    expect(await netWorth()).toEqual({ sections: [], net: { amounts: [], value: [] }, baseCommodity: null });
  });

  it("should return an empty sheet when hledger is missing entirely", async () => {
    const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    stubHledger({ bs: enoent, "bs:V": enoent });
    expect(await netWorth()).toEqual({ sections: [], net: { amounts: [], value: [] }, baseCommodity: null });
  });

  it("should run the vendored hledger binary when it exists in binDir", async () => {
    h.existsSync.mockReturnValue(true);
    stubHledger(emptyStubs);
    await netWorth();
    for (const call of h.execFile.mock.calls) {
      expect(call[0]).toBe("/vendored/bin/hledger");
    }
  });

  it("should fall back to a PATH lookup of `hledger` when the vendored binary is absent", async () => {
    h.existsSync.mockReturnValue(false);
    stubHledger(emptyStubs);
    await netWorth();
    for (const call of h.execFile.mock.calls) {
      expect(call[0]).toBe("hledger");
    }
  });
});

describe("ledger_transactions", () => {
  const amt = (commodity: string, floatingPoint: number, decimalPlaces = 2) => ({
    acommodity: commodity,
    aquantity: { decimalMantissa: 0, decimalPlaces, floatingPoint },
    astyle: { asprecision: decimalPlaces },
  });
  const PRINT = [
    JSON.stringify([
      {
        tindex: 1,
        tdate: "2026-01-05",
        tdescription: "Grocery Store | weekly shop",
        tstatus: "Cleared",
        ttags: [["category", "groceries"]],
        tpostings: [
          { paccount: "expenses:food", pamount: [amt("EUR", 12.5)] },
          { paccount: "assets:cash", pamount: [amt("EUR", -12.5)] },
        ],
      },
    ]),
  ];

  it("should return the parsed journal register", async () => {
    stubHledger({ print: PRINT });
    expect(await transactions()).toEqual([
      {
        index: 1,
        date: "2026-01-05",
        payee: "Grocery Store",
        note: "weekly shop",
        status: "Cleared",
        tags: [{ name: "category", value: "groceries" }],
        postings: [
          { account: "expenses:food", amounts: [{ quantity: 12.5, commodity: "EUR", precision: 2 }] },
          { account: "assets:cash", amounts: [{ quantity: -12.5, commodity: "EUR", precision: 2 }] },
        ],
      },
    ]);
  });

  it("should run one print as JSON with assertions ignored, against the workspace journal, in the workspace cwd, with the agent env", async () => {
    // -I: a failed balance assertion must not blank the register — the page
    // matters most when the ledger is in a broken state.
    stubHledger({ print: PRINT });
    await transactions();

    expect(h.execFile.mock.calls).toHaveLength(1);
    const call = h.execFile.mock.calls[0] as unknown[];
    expect(call[1]).toEqual(["print", "-O", "json", "-I", "-f", "/ws/ledger/main.journal"]);
    const opts = call[2] as { cwd: string; env: unknown; maxBuffer: number };
    expect(opts.cwd).toBe("/ws");
    expect(opts.env).toEqual({ PATH: "/vendored/bin", ACCOUNTANT24_WORKSPACE: "/ws" });
    // A journal of ~6k transactions overflows the 16 MB default; the register
    // needs the raised cap so years of history don't render as "empty".
    expect(opts.maxBuffer).toBe(256 * 1024 * 1024);
  });

  it("should return [] when hledger fails and no journal exists yet", async () => {
    stubHledger({ print: new Error("hledger: no journal") });
    expect(await transactions()).toEqual([]);
  });

  it("should reject when hledger fails against an existing journal", async () => {
    // An unreadable journal must not masquerade as an empty one: the reject
    // is the renderer's cue for the error message instead of "no
    // transactions yet".
    h.existsSync.mockImplementation((p) => p === "/ws/ledger/main.journal");
    stubHledger({ print: new Error("stdout maxBuffer length exceeded") });
    await expect(transactions()).rejects.toThrow();
  });

  it("should return [] when hledger is missing entirely and no journal exists", async () => {
    const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    stubHledger({ print: enoent });
    expect(await transactions()).toEqual([]);
  });

  it("should run the vendored hledger binary when it exists in binDir", async () => {
    h.existsSync.mockReturnValue(true);
    stubHledger({ print: PRINT });
    await transactions();
    expect(h.execFile.mock.calls[0]?.[0]).toBe("/vendored/bin/hledger");
  });

  it("should fall back to a PATH lookup of `hledger` when the vendored binary is absent", async () => {
    h.existsSync.mockReturnValue(false);
    stubHledger({ print: PRINT });
    await transactions();
    expect(h.execFile.mock.calls[0]?.[0]).toBe("hledger");
  });
});
