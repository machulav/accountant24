#!/usr/bin/env bun
// Release orchestrator (app-only desktop build):
//   1. preflight: working tree clean, on main, `gh` authenticated
//   2. bump version + generate changelog + tag (changelogen --release)
//   3. build the .app/.dmg (electron-builder, via `bun run dist`)
//   4. push main + tag
//   5. create a GitHub Release with the .dmg
//
// Usage:
//   bun run release            # full release
//   bun run release:dry        # show what would happen, no state changes
//
// Code signing / notarization is governed by electron-builder env vars
// (CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
// when present.
//
// NOTE: builds the host architecture only. Shipping both Apple-Silicon and Intel
// (or a universal) .dmg is a follow-up.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = join(ROOT, "packages", "desktop");
const DMG_DIR = join(DESKTOP, "release");
const DRY = process.argv.includes("--dry-run");

type CmdOpts = { cwd?: string; capture?: boolean; allowDry?: boolean };

async function sh(cmd: string[], opts: CmdOpts = {}): Promise<string> {
  console.log(`$ ${cmd.join(" ")}`);
  if (DRY && !opts.allowDry) return "";
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? ROOT,
    stdout: opts.capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const out = opts.capture ? await new Response(proc.stdout).text() : "";
  const code = await proc.exited;
  if (code !== 0) throw new Error(`Command failed (${code}): ${cmd.join(" ")}`);
  return out.trim();
}

async function main() {
  // 1. preflight checks
  const status = await sh(["git", "status", "--porcelain"], { capture: true, allowDry: true });
  if (status.length > 0) throw new Error(`Working tree not clean:\n${status}`);

  const branch = await sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], { capture: true, allowDry: true });
  if (branch !== "main") throw new Error(`Must release from main (currently on ${branch})`);

  await sh(["gh", "auth", "status"], { allowDry: true });

  // 2. capture release notes from changelogen (display-only mode outputs to stdout)
  const rawMarkdown = await sh(["bun", "run", "changelogen"], { capture: true, allowDry: true });
  const releaseNotes = rawMarkdown.split("\n").slice(2).join("\n").trim();

  // 3. bump version + write CHANGELOG.md + commit + tag via changelogen.
  //    No --push; push happens after a successful build so a failure can be rolled
  //    back with `git reset --hard HEAD~1 && git tag -d`.
  await sh(["bun", "run", "changelogen", "--release"]);

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const version: string = pkg.version;
  const tag = `v${version}`;
  console.log(`[release] staged ${tag}`);

  // 4. bundle the extension, build main/preload/renderer, then package the .app/.dmg.
  await sh(["bun", "run", "dist"]);

  // locate the produced .dmg(s)
  const dmgs = DRY ? [] : readdirSync(DMG_DIR).filter((f) => f.endsWith(".dmg")).map((f) => join(DMG_DIR, f));
  if (!DRY && dmgs.length === 0) throw new Error(`No .dmg found in ${DMG_DIR}`);
  for (const dmg of dmgs) console.log(`[release] built ${dmg}`);

  // 5. push main + tag
  await sh(["git", "push", "origin", "main"]);
  await sh(["git", "push", "origin", tag]);

  // 6. create the GitHub Release with the .dmg artifacts
  await sh(["gh", "release", "create", tag, "--title", tag, "--notes", releaseNotes, ...dmgs]);

  console.log(`[release] ✓ ${tag} published`);
}

main().catch((err) => {
  console.error("[release] failed:", err);
  process.exit(1);
});
