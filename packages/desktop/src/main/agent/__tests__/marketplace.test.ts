import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// marketplace.ts turns the published index into the rows Settings shows. The
// network and Electron are the faked boundaries; parsing, the app-version
// check, and the cache run for real.

type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  appVersion: "1.0.0",
  packaged: false,
  loadFailed: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getVersion: () => h.appVersion,
    get isPackaged() {
      return h.packaged;
    },
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
}));
vi.mock("../../analytics", () => ({ trackMarketplaceLoadFailed: h.loadFailed }));

// The index keeps what an author declares (`manifest`) apart from what GitHub
// reports (`repo`); the app flattens the two into one row.
interface IndexPlugin {
  id?: unknown;
  official?: unknown;
  manifest?: unknown;
  repo?: unknown;
  skills?: unknown;
}

/** An index entry, with `manifest` and `repo` patchable per case. */
const plugin = (manifest: Record<string, unknown> = {}, repo: Record<string, unknown> = {}): IndexPlugin => ({
  id: "acme/budget",
  official: false,
  manifest: { name: "budget", description: "Budget reviews.", version: "1.1.0", author: { name: "Ada" }, ...manifest },
  repo: {
    owner: {
      login: "acme",
      id: 1234,
      type: "Organization",
      url: "https://github.com/acme",
      avatarUrl: "https://avatars.githubusercontent.com/u/1234?v=4",
    },
    name: "budget",
    id: 99,
    url: "https://github.com/acme/budget",
    defaultBranch: "main",
    commit: "c0ffee",
    license: "Apache-2.0",
    description: "Budget reviews, from GitHub.",
    ...repo,
  },
  skills: [{ name: "monthly-review", description: "Reviews the month." }],
});

const BUDGET = plugin();

const index = (plugins: IndexPlugin[], overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  topic: "accountant24-plugin",
  plugins,
  ...overrides,
});

/** Serve one index document for any fetch. */
function serve(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

/** Serve a body that is not an index at all. */
function serveText(text: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(text, { status: 200 })),
  );
}

/** Fail every fetch with the given error. */
function serveThrow(error: Error): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw error;
    }),
  );
}

const timeoutError = () => Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });

type Result = Awaited<ReturnType<typeof import("../marketplace").fetchMarketplace>>;
type Entry = Extract<Result, { type: "ok" }>["plugins"][number];

let mod: typeof import("../marketplace");

beforeEach(async () => {
  h.handlers.clear();
  h.loadFailed.mockClear();
  h.appVersion = "1.0.0";
  h.packaged = false;
  delete process.env.A24_MARKETPLACE_URL;
  vi.resetModules();
  mod = await import("../marketplace");
  mod.registerMarketplaceIpc();
});

afterEach(() => {
  mod.resetMarketplaceCache();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.A24_MARKETPLACE_URL;
});

/** What the IPC handler returns, which is what the renderer sees. */
const fetchIndex = (payload?: unknown) => h.handlers.get("plugins_marketplace")?.(null, payload) as Promise<Result>;

const ok = async (payload?: unknown): Promise<Entry[]> => {
  const result = await fetchIndex(payload);
  if (result.type !== "ok") throw new Error(`expected ok, got: ${result.message}`);
  return result.plugins;
};

describe("parseMarketplaceIndex()", () => {
  it("should flatten a listed plugin into one row when the index is valid", () => {
    const entries = mod.parseMarketplaceIndex(index([BUDGET]), "1.0.0");
    expect(entries).toEqual([
      {
        repo: "acme/budget",
        repoUrl: "https://github.com/acme/budget",
        name: "budget",
        description: "Budget reviews.",
        version: "1.1.0",
        author: "Ada",
        official: false,
        skills: [{ name: "budget:monthly-review", description: "Reviews the month." }],
      },
    ]);
  });

  it("should return undefined when the document is not an object", () => {
    expect(mod.parseMarketplaceIndex([BUDGET], "1.0.0")).toBeUndefined();
  });

  it("should return undefined when the schema version is not 1", () => {
    expect(mod.parseMarketplaceIndex(index([BUDGET], { schemaVersion: 2 }), "1.0.0")).toBeUndefined();
  });

  it("should return undefined when plugins is not an array", () => {
    expect(mod.parseMarketplaceIndex({ schemaVersion: 1, plugins: {} }, "1.0.0")).toBeUndefined();
  });

  it("should return no plugins when the index lists none", () => {
    expect(mod.parseMarketplaceIndex(index([]), "1.0.0")).toEqual([]);
  });

  it("should take the repository from what GitHub reports, not from the id", () => {
    const entries = mod.parseMarketplaceIndex(index([{ ...BUDGET, id: "someone-else/budget" }]), "1.0.0");
    expect(entries?.[0]).toMatchObject({ repo: "acme/budget" });
  });

  it("should drop an entry with no manifest", () => {
    expect(mod.parseMarketplaceIndex(index([{ ...BUDGET, manifest: undefined }]), "1.0.0")).toEqual([]);
  });

  it("should drop an entry with no repository", () => {
    expect(mod.parseMarketplaceIndex(index([{ ...BUDGET, repo: undefined }]), "1.0.0")).toEqual([]);
  });

  it("should drop an entry whose repository has no owner login, and keep the rest", () => {
    const entries = mod.parseMarketplaceIndex(index([plugin({}, { owner: {} }), BUDGET]), "1.0.0");
    expect(entries?.map((e) => e.repo)).toEqual(["acme/budget"]);
  });

  it("should drop an entry whose repository has no name", () => {
    expect(mod.parseMarketplaceIndex(index([plugin({}, { name: undefined })]), "1.0.0")).toEqual([]);
  });

  it("should drop an entry whose owner and name do not form a plain owner/repo", () => {
    expect(mod.parseMarketplaceIndex(index([plugin({}, { name: "budget/extra" })]), "1.0.0")).toEqual([]);
  });

  it("should drop an entry whose name breaks the plugin name rules", () => {
    expect(mod.parseMarketplaceIndex(index([plugin({ name: "Budget Tools" })]), "1.0.0")).toEqual([]);
  });

  it("should drop an entry with no plugin name", () => {
    expect(mod.parseMarketplaceIndex(index([plugin({ name: undefined })]), "1.0.0")).toEqual([]);
  });

  it("should drop an entry that is not an object", () => {
    expect(mod.parseMarketplaceIndex(index(["acme/budget" as unknown as IndexPlugin]), "1.0.0")).toEqual([]);
  });

  it("should link to the repository page the index reports", () => {
    const entries = mod.parseMarketplaceIndex(index([plugin({}, { url: "https://github.com/acme/renamed" })]), "1.0.0");
    expect(entries?.[0].repoUrl).toBe("https://github.com/acme/renamed");
  });

  it("should link to GitHub anyway when the reported page is somewhere else", () => {
    const entries = mod.parseMarketplaceIndex(index([plugin({}, { url: "https://evil.example.com/acme" })]), "1.0.0");
    expect(entries?.[0].repoUrl).toBe("https://github.com/acme/budget");
  });

  it("should link to GitHub anyway when no page is reported", () => {
    const entries = mod.parseMarketplaceIndex(index([plugin({}, { url: undefined })]), "1.0.0");
    expect(entries?.[0].repoUrl).toBe("https://github.com/acme/budget");
  });

  it("should describe a plugin by its repository when the manifest says nothing", () => {
    const entries = mod.parseMarketplaceIndex(index([plugin({ description: undefined })]), "1.0.0");
    expect(entries?.[0].description).toBe("Budget reviews, from GitHub.");
  });

  it("should describe a plugin as empty when neither side says anything", () => {
    const entries = mod.parseMarketplaceIndex(
      index([plugin({ description: undefined }, { description: undefined })]),
      "1.0.0",
    );
    expect(entries?.[0].description).toBe("");
  });

  it("should prefer the author's description over the repository's", () => {
    expect(mod.parseMarketplaceIndex(index([BUDGET]), "1.0.0")?.[0].description).toBe("Budget reviews.");
  });

  it("should list no skills when the entry has none", () => {
    const entries = mod.parseMarketplaceIndex(index([{ ...BUDGET, skills: undefined }]), "1.0.0");
    expect(entries?.[0].skills).toEqual([]);
  });

  it("should drop a skill whose folder name breaks the naming rules", () => {
    const entries = mod.parseMarketplaceIndex(
      index([{ ...BUDGET, skills: [{ name: "Monthly Review" }, { name: "yearly-review", description: "Year." }] }]),
      "1.0.0",
    );
    expect(entries?.[0].skills).toEqual([{ name: "budget:yearly-review", description: "Year." }]);
  });

  it("should drop a skill that is not an object", () => {
    const entries = mod.parseMarketplaceIndex(index([{ ...BUDGET, skills: ["monthly-review"] }]), "1.0.0");
    expect(entries?.[0].skills).toEqual([]);
  });

  it("should drop a skill with no name", () => {
    const entries = mod.parseMarketplaceIndex(index([{ ...BUDGET, skills: [{ description: "No name." }] }]), "1.0.0");
    expect(entries?.[0].skills).toEqual([]);
  });

  it("should default a skill description to an empty string when it is missing", () => {
    const entries = mod.parseMarketplaceIndex(index([{ ...BUDGET, skills: [{ name: "monthly-review" }] }]), "1.0.0");
    expect(entries?.[0].skills).toEqual([{ name: "budget:monthly-review", description: "" }]);
  });

  it("should treat official as false when it is not exactly true", () => {
    expect(mod.parseMarketplaceIndex(index([{ ...BUDGET, official: "yes" }]), "1.0.0")?.[0].official).toBe(false);
  });

  it("should mark an entry official when the index says so", () => {
    expect(mod.parseMarketplaceIndex(index([{ ...BUDGET, official: true }]), "1.0.0")?.[0].official).toBe(true);
  });

  it("should drop a version that is not a string", () => {
    expect(mod.parseMarketplaceIndex(index([plugin({ version: 2 })]), "1.0.0")?.[0].version).toBeUndefined();
  });

  it("should keep the homepage and the string keywords", () => {
    const entries = mod.parseMarketplaceIndex(
      index([plugin({ homepage: "https://example.com", keywords: ["budget", 7, "review"] })]),
      "1.0.0",
    );
    expect(entries?.[0]).toMatchObject({ homepage: "https://example.com", keywords: ["budget", "review"] });
  });

  it("should list no keywords when none of them are strings", () => {
    expect(mod.parseMarketplaceIndex(index([plugin({ keywords: [1, 2] })]), "1.0.0")?.[0].keywords).toBeUndefined();
  });

  it("should ignore an author that is not an object", () => {
    expect(mod.parseMarketplaceIndex(index([plugin({ author: "Ada" })]), "1.0.0")?.[0].author).toBeUndefined();
  });

  it("should mark an entry as needing a newer app when minAppVersion is ahead", () => {
    const entries = mod.parseMarketplaceIndex(index([plugin({ minAppVersion: "1.1.0" })]), "1.0.0");
    expect(entries?.[0]).toMatchObject({ minAppVersion: "1.1.0", appTooOld: true });
  });

  it("should not mark an entry when minAppVersion equals the app version", () => {
    expect(
      mod.parseMarketplaceIndex(index([plugin({ minAppVersion: "1.0.0" })]), "1.0.0")?.[0].appTooOld,
    ).toBeUndefined();
  });

  it("should keep the first entry when two share a repository", () => {
    const entries = mod.parseMarketplaceIndex(
      index([BUDGET, plugin({ name: "budget-two" }, { owner: { login: "ACME" }, name: "Budget" })]),
      "1.0.0",
    );
    expect(entries?.map((e) => e.name)).toEqual(["budget"]);
  });
});

describe("plugins_marketplace", () => {
  it("should download the published index and list its plugins", async () => {
    serve(index([BUDGET]));
    expect(await ok()).toEqual([expect.objectContaining({ repo: "acme/budget" })]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(mod.MARKETPLACE_URL);
  });

  it("should identify itself and give up on a slow network", async () => {
    serve(index([BUDGET]));
    await ok();
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(init?.headers).toEqual({ "User-Agent": "accountant24" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("should report when the index was fetched", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T09:00:00.000Z"));
    serve(index([BUDGET]));
    const result = await fetchIndex();
    expect(result).toMatchObject({ type: "ok", fetchedAt: "2026-08-16T09:00:00.000Z" });
  });

  it("should serve the downloaded index again without asking the network", async () => {
    serve(index([BUDGET]));
    await ok();
    await ok();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("should download again once the cached index has aged out", async () => {
    vi.useFakeTimers();
    serve(index([BUDGET]));
    await ok();
    vi.setSystemTime(Date.now() + mod.MARKETPLACE_TTL_MS + 1);
    await ok();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("should download again when a refresh is forced", async () => {
    serve(index([BUDGET]));
    await ok();
    await ok({ force: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("should download once when two refreshes overlap", async () => {
    serve(index([BUDGET]));
    await Promise.all([fetchIndex({ force: true }), fetchIndex({ force: true })]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("should report a refused download and count it", async () => {
    serve(index([BUDGET]), 404);
    expect(await fetchIndex()).toEqual({ type: "error", message: "The plugin marketplace returned 404." });
    expect(h.loadFailed).toHaveBeenCalledWith("fetch_failed");
  });

  it("should report an unreachable marketplace and count it", async () => {
    serveThrow(new TypeError("fetch failed"));
    expect(await fetchIndex()).toEqual({
      type: "error",
      message: "Couldn't reach the plugin marketplace. Check your connection and try again.",
    });
    expect(h.loadFailed).toHaveBeenCalledWith("fetch_failed");
  });

  it("should report a marketplace that answers too slowly and count it", async () => {
    serveThrow(timeoutError());
    expect(await fetchIndex()).toEqual({
      type: "error",
      message: "The plugin marketplace took too long to respond. Check your connection and try again.",
    });
    expect(h.loadFailed).toHaveBeenCalledWith("timeout");
  });

  it("should report a body that is not JSON and count it as unreadable", async () => {
    // The bytes arrived (a captive portal's page, a CDN error page), so the
    // connection is not what failed.
    serveText("<html>404</html>");
    expect(await fetchIndex()).toEqual({
      type: "error",
      message: "The plugin marketplace sent something this version can't read.",
    });
    expect(h.loadFailed).toHaveBeenCalledWith("invalid_index");
  });

  it("should report an index this version cannot read and count it", async () => {
    serve(index([BUDGET], { schemaVersion: 99 }));
    expect(await fetchIndex()).toEqual({
      type: "error",
      message: "The plugin marketplace sent something this version can't read.",
    });
    expect(h.loadFailed).toHaveBeenCalledWith("invalid_index");
  });

  it("should keep serving the last downloaded index after a failed refresh", async () => {
    serve(index([BUDGET]));
    await ok();
    serveThrow(new TypeError("offline"));
    expect(await fetchIndex({ force: true })).toMatchObject({ type: "error" });
    // The next non-forced read is served from the cache the failure left alone.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("should not be called");
      }),
    );
    expect(await ok()).toEqual([expect.objectContaining({ repo: "acme/budget" })]);
  });

  it("should mark entries needing a newer app against the running version", async () => {
    h.appVersion = "0.9.0";
    serve(index([plugin({ minAppVersion: "1.2.0" })]));
    expect((await ok())[0].appTooOld).toBe(true);
  });

  it("should read a file the developer points it at", async () => {
    const dir = mkdtempSync(join(tmpdir(), "a24-marketplace-"));
    try {
      const file = join(dir, "marketplace.json");
      writeFileSync(file, JSON.stringify(index([BUDGET])));
      process.env.A24_MARKETPLACE_URL = pathToFileURL(file).href;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("should not be called");
        }),
      );
      expect(await ok()).toEqual([expect.objectContaining({ repo: "acme/budget" })]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should fetch a URL the developer points it at", async () => {
    process.env.A24_MARKETPLACE_URL = "http://127.0.0.1:8123/marketplace.json";
    serve(index([BUDGET]));
    await ok();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("http://127.0.0.1:8123/marketplace.json");
  });

  it("should ignore that override in a packaged app", async () => {
    h.packaged = true;
    process.env.A24_MARKETPLACE_URL = "http://127.0.0.1:8123/marketplace.json";
    serve(index([BUDGET]));
    await ok();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(mod.MARKETPLACE_URL);
  });
});
