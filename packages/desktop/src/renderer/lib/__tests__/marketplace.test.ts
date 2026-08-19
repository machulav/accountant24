import { describe, expect, it } from "vitest";
import { filterMarketplace, isInstalled, sortMarketplace } from "@/lib/marketplace";
import type { MarketplaceEntry, PluginInfo } from "@/rpc/types";

const entry = (over: Partial<MarketplaceEntry> = {}): MarketplaceEntry => ({
  repo: "acme/budget",
  repoUrl: "https://github.com/acme/budget",
  name: "budget",
  description: "Budget reviews.",
  official: false,
  skills: [{ name: "budget:monthly-review", description: "Reviews the month." }],
  ...over,
});

const plugin = (over: Partial<PluginInfo> = {}): PluginInfo => ({
  name: "budget",
  description: "Budget reviews.",
  skills: [],
  ...over,
});

describe("isInstalled()", () => {
  it("should count a plugin the app seeded as already there", () => {
    expect(isInstalled(entry(), [plugin({ source: "accountant24/skills" })])).toBe(true);
  });

  it("should count a plugin with the same name in the store as already there", () => {
    expect(isInstalled(entry(), [plugin({ source: "acme/budget" })])).toBe(true);
  });

  it("should count a plugin installed from that repository under another name as already there", () => {
    expect(isInstalled(entry(), [plugin({ name: "budget-renamed", source: "acme/budget" })])).toBe(true);
  });

  it("should not count an unrelated plugin", () => {
    expect(isInstalled(entry(), [plugin({ name: "taxes", source: "acme/taxes" })])).toBe(false);
  });

  it("should not count anything when the user has no plugins", () => {
    expect(isInstalled(entry(), [])).toBe(false);
  });
});

describe("sortMarketplace()", () => {
  it("should list official plugins before community ones", () => {
    const sorted = sortMarketplace([
      entry({ repo: "acme/zeta", name: "zeta" }),
      entry({ repo: "accountant24/skills", name: "accountant24-skills", official: true }),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["accountant24-skills", "zeta"]);
  });

  it("should list plugins of the same kind by name, ignoring case", () => {
    const sorted = sortMarketplace([
      entry({ repo: "acme/zeta", name: "zeta" }),
      entry({ repo: "acme/alpha", name: "Alpha" }),
      entry({ repo: "acme/beta", name: "beta" }),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["Alpha", "beta", "zeta"]);
  });

  it("should leave the given list untouched", () => {
    const entries = [entry({ repo: "acme/zeta", name: "zeta" }), entry({ repo: "acme/alpha", name: "alpha" })];
    sortMarketplace(entries);
    expect(entries.map((e) => e.name)).toEqual(["zeta", "alpha"]);
  });
});

describe("filterMarketplace()", () => {
  const entries = [
    entry({
      repo: "acme/budget",
      name: "budget",
      description: "Reviews spending every month.",
      author: "Ada Lovelace",
      keywords: ["envelope"],
      skills: [{ name: "budget:monthly-review", description: "Compares two months." }],
    }),
    entry({
      repo: "other/taxes",
      name: "taxes",
      description: "Prepares a tax return.",
      author: "Grace Hopper",
      skills: [{ name: "taxes:file-return", description: "Fills in the forms." }],
    }),
  ];
  const names = (query: string) => filterMarketplace(entries, query).map((e) => e.name);

  it("should return every plugin when the search is empty", () => {
    expect(names("")).toEqual(["budget", "taxes"]);
  });

  it("should return every plugin when the search is only spaces", () => {
    expect(names("   ")).toEqual(["budget", "taxes"]);
  });

  it("should match a plugin by name", () => {
    expect(names("taxes")).toEqual(["taxes"]);
  });

  it("should match a plugin by description", () => {
    expect(names("spending")).toEqual(["budget"]);
  });

  it("should match a plugin by author", () => {
    expect(names("grace")).toEqual(["taxes"]);
  });

  it("should match a plugin by repository", () => {
    expect(names("acme/")).toEqual(["budget"]);
  });

  it("should match a plugin by keyword", () => {
    expect(names("envelope")).toEqual(["budget"]);
  });

  it("should match a plugin by skill name", () => {
    expect(names("file-return")).toEqual(["taxes"]);
  });

  it("should match a plugin by skill description", () => {
    expect(names("forms")).toEqual(["taxes"]);
  });

  it("should ignore case", () => {
    expect(names("BUDGET")).toEqual(["budget"]);
  });

  it("should return nothing when no plugin matches", () => {
    expect(names("crypto")).toEqual([]);
  });

  it("should keep the order it was given", () => {
    expect(names("e")).toEqual(["budget", "taxes"]);
  });
});
