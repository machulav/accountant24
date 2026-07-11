import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ledger.ts answers the composer's @-mention query by running the vendored
// `hledger accounts|payees|tags` against the workspace journal. child_process
// (the real hledger binary), node:fs, Electron IPC, and env paths are the faked
// boundaries; the line-shaping (trim / drop-empty / case-insensitive sort) and
// the []-on-any-failure contract run for real.
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
  agentEnv: () => ({ PATH: "/vendored/bin", ACCOUNTANT24_HOME: "/ws" }),
}));

/** A canned hledger result per subcommand: an array of stdout lines, or an
 *  Error to simulate a failure (missing binary, no journal, parse error). */
type Response = string[] | Error;

/** Program execFile so each `hledger <sub>` returns the given canned result. */
function stubHledger(bySub: Record<string, Response>) {
  h.execFile.mockImplementation((_bin: string, args: string[], _opts: unknown, cb: ExecCb) => {
    const sub = args[0];
    const r = bySub[sub];
    if (r instanceof Error) {
      cb(r, "", "boom");
      return;
    }
    cb(null, (r ?? []).join("\n"), "");
  });
}

async function mentions(): Promise<{ accounts: string[]; payees: string[]; tags: string[] }> {
  const mod = await import("../ledger");
  mod.registerLedgerIpc();
  const handler = h.handlers.get("ledger_mentions");
  if (!handler) throw new Error("no handler for ledger_mentions");
  return (await handler(null)) as { accounts: string[]; payees: string[]; tags: string[] };
}

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
      expect(opts.env).toEqual({ PATH: "/vendored/bin", ACCOUNTANT24_HOME: "/ws" });
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
