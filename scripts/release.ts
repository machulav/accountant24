// Release orchestrator (app-only desktop build):
//   1. preflight: working tree clean, on main, `gh` authenticated
//   2. bump version + generate changelog + tag (changelogen --release)
//   3. build the .app/.dmg (electron-builder, via `npm run dist`)
//   4. push main + tag
//   5. create a GitHub Release with the .dmg
//
// Usage:
//   npm run release            # full release
//   npm run release:dry        # show what would happen, no state changes
//
// Code signing / notarization is governed by electron-builder env vars
// (CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID)
// when present.
//
// NOTE: builds the host architecture only. Shipping both Apple-Silicon and Intel
// (or a universal) .dmg is a follow-up.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = join(ROOT, "packages", "desktop");
const DMG_DIR = join(DESKTOP, "release");
const DRY = process.argv.includes("--dry-run");

type CmdOpts = { cwd?: string; capture?: boolean; allowDry?: boolean };

function sh(cmd: string[], opts: CmdOpts = {}): string {
  console.log(`$ ${cmd.join(" ")}`);
  if (DRY && !opts.allowDry) return "";
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: opts.cwd ?? ROOT,
    stdio: ["inherit", opts.capture ? "pipe" : "inherit", "inherit"],
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`Command failed (${r.status}): ${cmd.join(" ")}`);
  return opts.capture ? (r.stdout ?? "").trim() : "";
}

function main() {
  // 1. preflight checks
  const status = sh(["git", "status", "--porcelain"], { capture: true, allowDry: true });
  if (status.length > 0) throw new Error(`Working tree not clean:\n${status}`);

  const branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], { capture: true, allowDry: true });
  if (branch !== "main") throw new Error(`Must release from main (currently on ${branch})`);

  sh(["gh", "auth", "status"], { allowDry: true });

  // 2. capture release notes from changelogen (display-only mode outputs to stdout)
  const rawMarkdown = sh(["npx", "changelogen"], { capture: true, allowDry: true });
  const releaseNotes = rawMarkdown.split("\n").slice(2).join("\n").trim();

  // 3. bump version + write CHANGELOG.md + commit + tag via changelogen.
  //    No --push; push happens after a successful build so a failure can be rolled
  //    back with `git reset --hard HEAD~1 && git tag -d`.
  sh(["npx", "changelogen", "--release"]);

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const version: string = pkg.version;
  const tag = `v${version}`;
  console.log(`[release] staged ${tag}`);

  // 4. bundle the extension, build main/preload/renderer, then package the .app/.dmg.
  sh(["npm", "run", "dist"]);

  // locate the produced .dmg(s)
  const dmgs = DRY ? [] : readdirSync(DMG_DIR).filter((f) => f.endsWith(".dmg")).map((f) => join(DMG_DIR, f));
  if (!DRY && dmgs.length === 0) throw new Error(`No .dmg found in ${DMG_DIR}`);
  for (const dmg of dmgs) console.log(`[release] built ${dmg}`);

  // 5. push main + tag
  sh(["git", "push", "origin", "main"]);
  sh(["git", "push", "origin", tag]);

  // 6. create the GitHub Release with the .dmg artifacts
  sh(["gh", "release", "create", tag, "--title", tag, "--notes", releaseNotes, ...dmgs]);

  console.log(`[release] ✓ ${tag} published`);
}

try {
  main();
} catch (err) {
  console.error("[release] failed:", err);
  process.exit(1);
}
