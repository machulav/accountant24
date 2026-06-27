#!/usr/bin/env bun
// Bundle the pi extension to a single self-contained ESM file that the desktop
// app loads via `pi -e`. pi's virtual modules are externalized so they resolve
// against node_modules at load time (the agent runs under Electron-as-Node, so
// node_modules is present). This is the lightweight dev/prelaunch step; the
// release build calls the same bundling.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const cmd = [
  "bun",
  "build",
  join(ROOT, "packages", "pi-extension", "src", "entry.ts"),
  "--target=node",
  "--format=esm",
  "--outfile",
  OUT,
  ...VIRTUAL_MODULES.flatMap((m) => ["--external", m]),
];

console.log(`$ ${cmd.join(" ")}`);
const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
const code = await proc.exited;
if (code !== 0) process.exit(code);
console.log(`[bundle-extension] → ${OUT}`);
