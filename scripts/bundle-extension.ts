// Bundle the pi extension to a single self-contained ESM file that the desktop
// app loads via `pi -e`. pi's virtual modules are externalized so they resolve
// against node_modules at load time (the agent runs under Electron-as-Node, so
// node_modules is present). Templates imported via `with { type: "text" }` are
// inlined by the text loaders below. This is the lightweight dev/prelaunch step;
// the release build calls the same bundling.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "packages", "desktop", "resources", "accountant24-extension.js");

const VIRTUAL_MODULES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/oauth",
  "typebox",
  "typebox/compile",
  "typebox/value",
  "@sinclair/typebox",
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

console.log(`[bundle-extension] → ${OUT}`);
