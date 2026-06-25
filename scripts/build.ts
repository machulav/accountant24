#!/usr/bin/env bun
// Build orchestrator for the desktop app's embedded agent.
//
// Produces three artifacts and stages them into the Tauri app:
//   1. `pi`                        — stock pi-coding-agent CLI, bun-compiled (the agent sidecar)
//   2. `accountant24-extension.js` — our customization, pre-bundled to a single self-contained
//                                    ESM file, loaded by pi via `-e`
//   3. `accountant24-auth`         — small auth helper binary (AuthStorage/ModelRegistry over JSON)
//
// pi's package.json + theme/ + export-html/ are staged into resources/pi/ and exposed to the
// sidecar via PI_PACKAGE_DIR (see desktop/src-tauri/src/env.rs). The extension bundle externalizes
// pi's virtual modules so its only bare imports resolve against pi's bundled copies at load time.
//
// Usage:
//   bun run build                          # host target
//   TARGET=bun-darwin-x64 bun run build    # cross-compile one target
//   bun run build --all                    # all four targets

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = join(ROOT, "release");
const PI = join(ROOT, "node_modules", "@earendil-works", "pi-coding-agent");
const DESKTOP = join(ROOT, "packages", "desktop", "src-tauri");
const DESKTOP_BINARIES = join(DESKTOP, "binaries");

const ALL_TARGETS = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-x64", "bun-linux-arm64"] as const;
type Target = (typeof ALL_TARGETS)[number];

/** Rust target triples Tauri appends to sidecar names (`externalBin`). */
const RUST_TRIPLE: Record<Target, string> = {
  "bun-darwin-arm64": "aarch64-apple-darwin",
  "bun-darwin-x64": "x86_64-apple-darwin",
  "bun-linux-x64": "x86_64-unknown-linux-gnu",
  "bun-linux-arm64": "aarch64-unknown-linux-gnu",
};

// pi's virtual modules. When the extension is loaded inside the compiled pi binary, jiti resolves
// these against pi's bundled copies (no node_modules in the app). We externalize exactly these so
// the bundle's only bare imports are virtual modules + node builtins; file-type/chalk get inlined.
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

async function run(cmd: string[], cwd = ROOT): Promise<void> {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`Command failed (${code}): ${cmd.join(" ")}`);
}

function resolveHostTarget(): Target {
  const platform = process.platform; // "darwin" | "linux" | ...
  const arch = process.arch === "x64" ? "x64" : "arm64";
  const candidate = `bun-${platform}-${arch}` as Target;
  if (!ALL_TARGETS.includes(candidate)) {
    throw new Error(`Host platform ${platform}-${arch} is not a supported target`);
  }
  return candidate;
}

/** Step 1 — compile stock pi to a self-contained binary for `target`. */
async function buildPi(target: Target): Promise<void> {
  console.log(`[build] compiling pi for ${target}`);
  // Single entrypoint: pi's image-resize worker has an in-process fallback for compiled-binary
  // layouts (dist/utils/image-resize.js), so a 2nd worker entrypoint buys nothing here.
  await run([
    "bun",
    "build",
    "--compile",
    "--minify",
    "--sourcemap",
    `--target=${target}`,
    join(PI, "dist", "bun", "cli.js"),
    "--outfile",
    join(RELEASE, target, "pi"),
  ]);
}

/** Step 2 — bundle the extension to one self-contained ESM file (target-independent). */
async function bundleExtension(): Promise<string> {
  const out = join(RELEASE, "accountant24-extension.js");
  console.log("[build] bundling extension");
  // No --minify: keep jiti-side stack traces readable; size is irrelevant inside an .app.
  await run([
    "bun",
    "build",
    join(ROOT, "packages", "pi-extension", "src", "entry.ts"),
    "--target=node",
    "--format=esm",
    "--outfile",
    out,
    ...VIRTUAL_MODULES.flatMap((m) => ["--external", m]),
  ]);
  return out;
}

/** Step 3 — compile the auth helper binary for `target` (normal bundling, not jiti). */
async function buildAuth(target: Target): Promise<void> {
  console.log(`[build] compiling auth helper for ${target}`);
  await run([
    "bun",
    "build",
    "--compile",
    "--minify",
    "--sourcemap",
    `--target=${target}`,
    join(ROOT, "packages", "auth-helper-cli", "src", "auth-main.ts"),
    "--outfile",
    join(RELEASE, target, "accountant24-auth"),
  ]);
}

/** Stage pi's sibling runtime assets into resources/pi-assets/ (read via PI_PACKAGE_DIR).
 *  Named `pi-assets` (not `pi`) to avoid colliding with the `pi` externalBin sidecar. */
function stagePiAssets(): void {
  const dest = join(DESKTOP, "pi-assets");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  // pi's OWN package.json (drives APP_NAME / configDir / VERSION).
  cpSync(join(PI, "package.json"), join(dest, "package.json"));
  cpSync(join(PI, "dist", "modes", "interactive", "theme"), join(dest, "theme"), { recursive: true });
  cpSync(join(PI, "dist", "core", "export-html"), join(dest, "export-html"), { recursive: true });
  console.log(`[build] staged pi assets → ${dest}`);
}

/** Stage the bundled extension as a Tauri resource. */
function stageExtension(extPath: string): void {
  const dest = join(DESKTOP, "accountant24-extension.js");
  cpSync(extPath, dest);
  console.log(`[build] staged extension → ${dest}`);
}

/** Stage the pi + auth binaries as Tauri sidecars under their Rust-triple names. */
function stageSidecars(target: Target): void {
  mkdirSync(DESKTOP_BINARIES, { recursive: true });
  const triple = RUST_TRIPLE[target];
  cpSync(join(RELEASE, target, "pi"), join(DESKTOP_BINARIES, `pi-${triple}`));
  cpSync(join(RELEASE, target, "accountant24-auth"), join(DESKTOP_BINARIES, `accountant24-auth-${triple}`));
  console.log(`[build] staged sidecars pi-${triple}, accountant24-auth-${triple}`);
}

async function main() {
  if (!existsSync(PI)) {
    throw new Error(`pi-coding-agent not found at ${PI}. Run \`bun install\` first.`);
  }

  const buildAll = process.argv.includes("--all");
  const envTarget = process.env.TARGET as Target | undefined;
  const targets: Target[] = buildAll ? [...ALL_TARGETS] : envTarget ? [envTarget] : [resolveHostTarget()];

  mkdirSync(RELEASE, { recursive: true });

  // Target-independent artifacts (built once).
  const extPath = await bundleExtension();
  stagePiAssets();
  stageExtension(extPath);

  // Per-target binaries.
  for (const target of targets) {
    mkdirSync(join(RELEASE, target), { recursive: true });
    await buildPi(target);
    await buildAuth(target);
    stageSidecars(target);
  }

  console.log(`[build] done (${targets.length} target${targets.length === 1 ? "" : "s"})`);
}

main().catch((err) => {
  console.error("[build] failed:", err);
  process.exit(1);
});
