// Release preparer. The actual build + publish happens in CI (GitHub Actions,
// .github/workflows/release.yml), triggered by the tag this script pushes.
//   1. preflight: working tree clean, on main
//   2. bump version + generate CHANGELOG.md + tag (changelogen --release)
//   3. push main + tag
//
// The tag push triggers CI, which builds the arm64 + x64 dmgs, creates the
// GitHub Release (notes sourced from the new CHANGELOG.md section), attaches the
// artifacts, and publishes it. CI owns release creation so there's no race with
// this script.
//
// Usage:
//   npm run release            # bump, tag, push (CI builds + publishes)
//   npm run release:dry        # show what would happen, no state changes

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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

  // 2. bump version + write CHANGELOG.md + commit + tag via changelogen.
  sh(["npx", "changelogen", "--release"]);

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const version: string = pkg.version;
  const tag = `v${version}`;
  console.log(`[release] staged ${tag}`);

  // 3. push main + tag. The tag push triggers the release workflow, which builds
  //    the dmgs and creates + publishes the GitHub Release.
  sh(["git", "push", "origin", "main"]);
  sh(["git", "push", "origin", tag]);

  console.log(`[release] ✓ pushed ${tag} — CI will build and publish the release`);
}

try {
  main();
} catch (err) {
  console.error("[release] failed:", err);
  process.exit(1);
}
