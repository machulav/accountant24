import { beforeEach, describe, expect, it, vi } from "vitest";
import { asProviderDefaults } from "../pi-defaults";

// providerDefaults() deliberately loads the REAL pi package rather than a mock:
// the whole point of pi-defaults.ts is that it can still reach pi's
// default-model table, which pi does not export. A pi bump that moves or
// renames the table must fail here instead of silently degrading every
// automatic model pick to "first available model".

describe("providerDefaults()", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("node:url");
  });

  it("should expose a default model id for pi's mainstream providers", async () => {
    const { providerDefaults } = await import("../pi-defaults");
    const table = await providerDefaults();

    for (const provider of ["anthropic", "openai", "google"]) {
      expect(typeof table[provider]).toBe("string");
      expect(table[provider].length).toBeGreaterThan(0);
    }
  });

  it("should expose only string model ids", async () => {
    const { providerDefaults } = await import("../pi-defaults");
    const table = await providerDefaults();

    expect(Object.keys(table).length).toBeGreaterThan(0);
    for (const id of Object.values(table)) expect(typeof id).toBe("string");
  });

  it("should read the table once and reuse it", async () => {
    const { providerDefaults } = await import("../pi-defaults");

    expect(await providerDefaults()).toBe(await providerDefaults());
  });

  it("should return an empty table when pi cannot be located", async () => {
    vi.doMock("node:url", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:url")>()),
      fileURLToPath: () => {
        throw new Error("Cannot find package '@earendil-works/pi-coding-agent'");
      },
    }));

    const { providerDefaults } = await import("../pi-defaults");

    expect(await providerDefaults()).toEqual({});
  });

  it("should return an empty table when pi no longer ships the resolver file", async () => {
    vi.doMock("node:url", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:url")>()),
      fileURLToPath: () => "/nonexistent/pi/dist/index.js",
    }));

    const { providerDefaults } = await import("../pi-defaults");

    expect(await providerDefaults()).toEqual({});
  });
});

describe("asProviderDefaults()", () => {
  it("should pass a table of provider ids through unchanged", () => {
    const table = { anthropic: "claude-x", openai: "gpt-x" };

    expect(asProviderDefaults(table)).toEqual(table);
  });

  it("should return an empty table when pi renamed the export away", () => {
    expect(asProviderDefaults(undefined)).toEqual({});
  });

  it("should return an empty table when the export is not an object", () => {
    expect(asProviderDefaults("claude-x")).toEqual({});
  });

  it("should return an empty table when the export is null", () => {
    expect(asProviderDefaults(null)).toEqual({});
  });
});
