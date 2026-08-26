import { describe, expect, it } from "vitest";
import { checkMinAppVersion, parsePluginManifest, pluginNameError } from "../plugin-manifest";

// The plugin.json rules of the Agent Plugins format, as the app enforces them:
// a closed schema (an unknown field is a typo, not a capability we silently
// drop), a name that is safe to use as both a folder and a skill namespace,
// and a minimum app version that gates installs.

/** Serialize an object literal the way a plugin.json on disk would read. */
const SCHEMA_URL = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

/** A manifest with the required $schema filled in, unless the case overrides it. */
const manifest = (value: Record<string, unknown>): string => JSON.stringify({ $schema: SCHEMA_URL, ...value });

describe("pluginNameError()", () => {
  it("should accept a lowercase name with interior hyphens", () => {
    expect(pluginNameError("monthly-budget-review")).toBeUndefined();
  });

  it("should accept a single character", () => {
    expect(pluginNameError("a")).toBeUndefined();
  });

  it("should accept digits", () => {
    expect(pluginNameError("plan9")).toBeUndefined();
  });

  it("should reject an empty name", () => {
    expect(pluginNameError("")).toBe("plugin.json: name is empty.");
  });

  it("should accept a name of exactly 64 characters", () => {
    expect(pluginNameError("a".repeat(64))).toBeUndefined();
  });

  it("should reject a name of 65 characters", () => {
    expect(pluginNameError("a".repeat(65))).toBe("plugin.json: name exceeds 64 characters.");
  });

  it("should reject uppercase letters", () => {
    expect(pluginNameError("Budget")).toBe(
      "plugin.json: name may only contain lowercase letters, numbers, and hyphens.",
    );
  });

  it("should reject a period, which the wider spec allows but this app does not", () => {
    expect(pluginNameError("com.example.budget")).toBe(
      "plugin.json: name may only contain lowercase letters, numbers, and hyphens.",
    );
  });

  it("should reject a colon, which would collide with the skill namespace separator", () => {
    expect(pluginNameError("budget:review")).toBe(
      "plugin.json: name may only contain lowercase letters, numbers, and hyphens.",
    );
  });

  it("should reject a leading hyphen", () => {
    expect(pluginNameError("-budget")).toBe("plugin.json: name may not start or end with a hyphen.");
  });

  it("should reject a trailing hyphen", () => {
    expect(pluginNameError("budget-")).toBe("plugin.json: name may not start or end with a hyphen.");
  });

  it("should reject consecutive hyphens", () => {
    expect(pluginNameError("budget--review")).toBe("plugin.json: name may not contain consecutive hyphens.");
  });
});

describe("checkMinAppVersion()", () => {
  it("should allow an app version above the requirement", () => {
    expect(checkMinAppVersion("1.2.3", "1.2.4")).toBe(true);
  });

  it("should allow an app version equal to the requirement", () => {
    expect(checkMinAppVersion("1.2.3", "1.2.3")).toBe(true);
  });

  it("should block an app version below the requirement", () => {
    expect(checkMinAppVersion("1.2.3", "1.2.2")).toBe(false);
  });

  it("should compare the major part first", () => {
    expect(checkMinAppVersion("2.0.0", "1.99.99")).toBe(false);
    expect(checkMinAppVersion("1.99.99", "2.0.0")).toBe(true);
  });

  it("should compare the minor part before the patch part", () => {
    expect(checkMinAppVersion("1.3.0", "1.2.99")).toBe(false);
    expect(checkMinAppVersion("1.2.99", "1.3.0")).toBe(true);
  });

  it("should ignore a prerelease suffix on the app version", () => {
    expect(checkMinAppVersion("0.3.0", "0.3.0-rc.1")).toBe(true);
    expect(checkMinAppVersion("0.4.0", "0.3.0-rc.1")).toBe(false);
  });

  it("should not block an install when the app version can't be parsed", () => {
    expect(checkMinAppVersion("1.0.0", "dev")).toBe(true);
  });
});

describe("parsePluginManifest()", () => {
  it("should refuse a manifest without $schema", () => {
    expect(parsePluginManifest(JSON.stringify({ name: "budget" }))).toEqual({
      ok: false,
      error: "plugin.json: $schema is required.",
    });
  });

  it("should refuse a $schema that is not a string", () => {
    expect(parsePluginManifest(manifest({ $schema: 7, name: "budget" }))).toEqual({
      ok: false,
      error: "plugin.json: $schema is required.",
    });
  });

  it("should accept a manifest with only $schema and a name", () => {
    const result = parsePluginManifest(manifest({ name: "budget" }));
    expect(result).toEqual({ ok: true, manifest: { name: "budget" } });
  });

  it("should keep every metadata field the format defines", () => {
    const result = parsePluginManifest(
      manifest({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "budget",
        version: "1.2.0",
        description: "Budget reviews.",
        author: { name: "Ada", email: "ada@example.com", url: "https://example.com" },
        homepage: "https://example.com/budget",
        repository: "https://github.com/example/budget",
        license: "MIT",
        keywords: ["budget", "review"],
      }),
    );
    expect(result).toEqual({
      ok: true,
      manifest: {
        name: "budget",
        version: "1.2.0",
        description: "Budget reviews.",
        author: { name: "Ada", email: "ada@example.com", url: "https://example.com" },
        homepage: "https://example.com/budget",
        repository: "https://github.com/example/budget",
        license: "MIT",
        keywords: ["budget", "review"],
      },
    });
  });

  it("should reject text that is not JSON", () => {
    expect(parsePluginManifest("{not json")).toEqual({ ok: false, error: "plugin.json is not valid JSON." });
  });

  it("should reject a JSON array", () => {
    expect(parsePluginManifest("[]")).toEqual({ ok: false, error: "plugin.json must contain a JSON object." });
  });

  it("should reject a JSON literal", () => {
    expect(parsePluginManifest("null")).toEqual({ ok: false, error: "plugin.json must contain a JSON object." });
  });

  it("should reject a manifest without a name", () => {
    expect(parsePluginManifest(manifest({ description: "No name." }))).toEqual({
      ok: false,
      error: "plugin.json: name is required.",
    });
  });

  it("should reject a non-string name", () => {
    expect(parsePluginManifest(manifest({ name: 7 }))).toEqual({ ok: false, error: "plugin.json: name is required." });
  });

  it("should report why an invalid name is invalid", () => {
    expect(parsePluginManifest(manifest({ name: "Budget" }))).toEqual({
      ok: false,
      error: "plugin.json: name may only contain lowercase letters, numbers, and hyphens.",
    });
  });

  it("should reject an unknown top-level field so a typo can't silently do nothing", () => {
    expect(parsePluginManifest(manifest({ name: "budget", skils: "./skills" }))).toEqual({
      ok: false,
      error: "plugin.json: unknown field skils.",
    });
  });

  it("should list every unknown field, sorted", () => {
    expect(parsePluginManifest(manifest({ name: "budget", zeta: 1, alpha: 2 }))).toEqual({
      ok: false,
      error: "plugin.json: unknown field alpha, zeta.",
    });
  });

  it("should reject a non-string metadata field", () => {
    expect(parsePluginManifest(manifest({ name: "budget", version: 2 }))).toEqual({
      ok: false,
      error: "plugin.json: version must be a string.",
    });
  });

  it("should reject a non-object author", () => {
    expect(parsePluginManifest(manifest({ name: "budget", author: "Ada" }))).toEqual({
      ok: false,
      error: "plugin.json: author must be an object.",
    });
  });

  it("should reject a non-string author field", () => {
    expect(parsePluginManifest(manifest({ name: "budget", author: { name: 1 } }))).toEqual({
      ok: false,
      error: "plugin.json: author.name must be a string.",
    });
  });

  it("should accept an empty author object", () => {
    expect(parsePluginManifest(manifest({ name: "budget", author: {} }))).toEqual({
      ok: true,
      manifest: { name: "budget", author: {} },
    });
  });

  it("should reject keywords that are not an array of strings", () => {
    expect(parsePluginManifest(manifest({ name: "budget", keywords: "budget" }))).toEqual({
      ok: false,
      error: "plugin.json: keywords must be an array of strings.",
    });
    expect(parsePluginManifest(manifest({ name: "budget", keywords: ["a", 2] }))).toEqual({
      ok: false,
      error: "plugin.json: keywords must be an array of strings.",
    });
  });

  it("should read minAppVersion out of the app's extension namespace", () => {
    const result = parsePluginManifest(
      manifest({ name: "budget", extensions: { "ai.accountant24": { minAppVersion: "1.4.0" } } }),
    );
    expect(result).toEqual({ ok: true, manifest: { name: "budget", minAppVersion: "1.4.0" } });
  });

  it("should ignore another client's extension namespace", () => {
    const result = parsePluginManifest(
      manifest({ name: "budget", extensions: { "com.example.client": { anything: [1, 2] } } }),
    );
    expect(result).toEqual({ ok: true, manifest: { name: "budget" } });
  });

  it("should accept a manifest whose extensions omit the app's namespace", () => {
    expect(parsePluginManifest(manifest({ name: "budget", extensions: {} }))).toEqual({
      ok: true,
      manifest: { name: "budget" },
    });
  });

  it("should reject non-object extensions", () => {
    expect(parsePluginManifest(manifest({ name: "budget", extensions: [] }))).toEqual({
      ok: false,
      error: "plugin.json: extensions must be an object.",
    });
  });

  it("should reject a non-object entry under the app's namespace", () => {
    expect(parsePluginManifest(manifest({ name: "budget", extensions: { "ai.accountant24": "1.0.0" } }))).toEqual({
      ok: false,
      error: 'plugin.json: extensions["ai.accountant24"] must be an object.',
    });
  });

  it("should reject a minAppVersion that is not a three-part version", () => {
    expect(
      parsePluginManifest(manifest({ name: "budget", extensions: { "ai.accountant24": { minAppVersion: "1.4" } } })),
    ).toEqual({ ok: false, error: "plugin.json: minAppVersion must be a version like 1.2.3." });
    expect(
      parsePluginManifest(manifest({ name: "budget", extensions: { "ai.accountant24": { minAppVersion: 1 } } })),
    ).toEqual({ ok: false, error: "plugin.json: minAppVersion must be a version like 1.2.3." });
  });

  it("should accept a namespace entry without a minAppVersion", () => {
    expect(parsePluginManifest(manifest({ name: "budget", extensions: { "ai.accountant24": {} } }))).toEqual({
      ok: true,
      manifest: { name: "budget" },
    });
  });
});
