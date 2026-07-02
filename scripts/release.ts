// Release preparer. The actual build + publish happens in CI (GitHub Actions,
// .github/workflows/release.yml), triggered by the tag this script pushes.
//   1. preflight: working tree clean, on main
//   2. bump version + generate CHANGELOG.md + tag (changelogen --release)
//      — or, with --rc, bump to the next X.Y.Z-rc.N without touching CHANGELOG.md
//   3. push main + tag
//
// The tag push triggers CI, which builds the arm64 + x64 dmgs, creates the
// GitHub Release (notes sourced from the new CHANGELOG.md section; rc tags get
// a generic note and are marked as prereleases), attaches the artifacts, and
// publishes it. CI owns release creation so there's no race with this script.
//
// Release candidates: --rc bumps to the next version with an -rc.N suffix
// (rc.1, rc.2, ... while iterating). The final `npm run release` afterwards
// drops the suffix and generates the CHANGELOG.md section from the last stable
// tag, so rc iterations never fragment the release notes.
//
// Usage:
//   npm run release            # bump, tag, push (CI builds + publishes)
//   npm run release:rc         # same, but as a vX.Y.Z-rc.N prerelease
//   npm run release:dry        # show what would happen, no state changes
//   npm run release:dry -- --rc

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { determineSemverChange, getGitDiff, loadChangelogConfig, parseCommits } from "changelogen";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const RC = process.argv.includes("--rc");

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

/** Latest non-rc vX.Y.Z tag, or undefined if none exist yet. */
function lastStableTag(): string | undefined {
  const tags = sh(["git", "tag", "-l", "v*", "--sort=-v:refname"], { capture: true, allowDry: true });
  return tags.split("\n").find((t) => t !== "" && !t.includes("-rc."));
}

/**
 * Next rc version. On a stable version, applies the semver bump implied by the
 * commits since the last tag (mirroring changelogen's pre-1.0 softening:
 * major→minor, minor→patch) and starts at rc.1; on an existing rc, just
 * increments N.
 */
async function nextRcVersion(current: string): Promise<string> {
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/);
  if (!m) throw new Error(`Unexpected version in package.json: ${current}`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] !== undefined) return `${major}.${minor}.${patch}-rc.${Number(m[4]) + 1}`;

  const config = await loadChangelogConfig(ROOT);
  const commits = parseCommits(await getGitDiff(config.from, config.to, ROOT), config);
  let type = determineSemverChange(commits, config) ?? "patch";
  if (major === 0) {
    if (type === "major") type = "minor";
    else if (type === "minor") type = "patch";
  }
  if (type === "major") return `${major + 1}.0.0-rc.1`;
  if (type === "minor") return `${major}.${minor + 1}.0-rc.1`;
  return `${major}.${minor}.${patch + 1}-rc.1`;
}

async function main() {
  // 1. preflight checks
  const status = sh(["git", "status", "--porcelain"], { capture: true, allowDry: true });
  if (status.length > 0) throw new Error(`Working tree not clean:\n${status}`);

  const branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], { capture: true, allowDry: true });
  if (branch !== "main") throw new Error(`Must release from main (currently on ${branch})`);

  // 2. bump version + commit + tag.
  let version: string;
  if (RC) {
    // rc: bump package.json only — CHANGELOG.md is written once, by the final release.
    const pkgPath = join(ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    version = await nextRcVersion(pkg.version);
    console.log(`[release] bumping ${pkg.version} → ${version}`);
    if (!DRY) {
      pkg.version = version;
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    sh(["git", "add", "package.json"]);
    sh(["git", "commit", "-m", `chore(release): v${version}`]);
    sh(["git", "tag", `v${version}`]);
  } else {
    // final: changelogen bumps version, writes CHANGELOG.md, commits, and tags.
    // Generate notes from the last stable tag so rc iterations don't fragment them.
    const from = lastStableTag();
    sh(["npx", "changelogen", "--release", ...(from ? ["--from", from] : [])]);
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    version = pkg.version;
  }
  const tag = `v${version}`;
  console.log(`[release] staged ${tag}`);

  // 3. push main + tag. The tag push triggers the release workflow, which builds
  //    the dmgs and creates + publishes the GitHub Release.
  sh(["git", "push", "origin", "main"]);
  sh(["git", "push", "origin", tag]);

  console.log(`[release] ✓ pushed ${tag} — CI will build and publish the release`);
}

main().catch((err) => {
  console.error("[release] failed:", err);
  process.exit(1);
});
