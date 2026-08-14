// pi's opinionated default model per provider — the table the app uses to
// preselect a default model when a provider is connected.
//
// pi keeps this table in dist/core/model-resolver.js but does not re-export it
// (its package exports map only exposes ".", "./rpc-entry" and "./client"), so
// it is loaded from the file next to pi's resolved entry point. Importing by
// absolute file path bypasses the exports map, and packaged builds ship pi's
// dist/ as real files (asar is off), so the same path resolves in dev and in
// production. If pi ever moves the file, the load fails softly and the table is
// empty — callers then fall back to the provider's first model, which is pi's
// own last resort. __tests__/pi-defaults.test.ts loads the real file, so a pi
// bump that breaks this turns red in CI instead of silently degrading.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** provider id -> pi's default model id for it. */
export type ProviderDefaults = Record<string, string>;

/** Accept pi's table only if it still looks like one, so a renamed export
 *  yields no opinion instead of breaking the models IPC. */
export function asProviderDefaults(table: unknown): ProviderDefaults {
  return typeof table === "object" && table !== null ? (table as ProviderDefaults) : {};
}

let cached: Promise<ProviderDefaults> | undefined;

async function load(): Promise<ProviderDefaults> {
  try {
    // import.meta.resolve, not createRequire().resolve: pi's exports map offers
    // the "import" condition only, which CommonJS resolution cannot satisfy.
    const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const resolver = join(dirname(entry), "core", "model-resolver.js");
    const module: { defaultModelPerProvider?: unknown } = await import(pathToFileURL(resolver).href);
    return asProviderDefaults(module.defaultModelPerProvider);
  } catch {
    return {};
  }
}

/** pi's default model per provider. Loaded once per process. */
export function providerDefaults(): Promise<ProviderDefaults> {
  cached ??= load();
  return cached;
}
