// Bundle the pi extension to a single self-contained ESM file that the desktop
// app loads via `pi -e`. pi's virtual modules are externalized so they resolve
// against node_modules at load time (the agent runs under Electron-as-Node, so
// node_modules is present). Templates imported via `with { type: "text" }` are
// inlined by the text loaders below. This is the lightweight dev/prelaunch step;
// the release build calls the same bundling.

import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "packages", "desktop", "resources", "accountant24-extension.js");
const SYSTEM_MD_SRC = join(ROOT, "packages", "pi-extension", "src", "system-prompt", "system.md");
const SYSTEM_MD_OUT = join(ROOT, "packages", "desktop", "resources", "system.md");

// Mirrors the alias table pi's extension loader injects (its own
// VIRTUAL_MODULES, in core/extensions/loader.ts). Bundling any of these would
// give the extension a second copy of a module pi expects to be a singleton, so
// re-check this list against the loader on every pi upgrade.
const VIRTUAL_MODULES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat",
  "@earendil-works/pi-ai/oauth",
  "@earendil-works/pi-ai/providers/all",
  "typebox",
  "typebox/compile",
  "typebox/value",
  "@sinclair/typebox",
  "@sinclair/typebox/compile",
  "@sinclair/typebox/value",
];

await build({
  entryPoints: [join(ROOT, "packages", "pi-extension", "src", "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: OUT,
  external: VIRTUAL_MODULES,
  loader: { ".md": "text", ".journal": "text", ".gitignore": "text" },
  logLevel: "info",
});

// system.md ships as its own resource: the app passes it to pi via
// --system-prompt, so pi natively appends the skills block around it.
copyFileSync(SYSTEM_MD_SRC, SYSTEM_MD_OUT);

console.log(`[bundle-extension] → ${OUT}`);
console.log(`[bundle-extension] → ${SYSTEM_MD_OUT}`);
