// Release preparer, executed BY CI (the Release workflow,
// .github/workflows/release.yml, dispatched from the Actions tab or via
// `npm run release` / `npm run release:rc`, which are `gh workflow run`
// wrappers). Locally only --dry-run is expected: a tag pushed from a laptop
// no longer triggers anything — the workflow is dispatch-only, and it cuts
// the tag itself before building.
//   1. preflight: working tree clean, on main
//   2. bump version + generate CHANGELOG.md + tag (changelogen --release)
//      — or, with --rc, bump to the next X.Y.Z-rc.N without touching CHANGELOG.md
//   3. push main + tag; expose the tag via GITHUB_OUTPUT for downstream jobs
//
// The same workflow run then builds the dmg, creates the GitHub Release
// (notes sourced from the new CHANGELOG.md section; rc tags get a generic
// note and are marked as prereleases), attaches the artifacts, verifies them,
// and publishes.
//
// Release candidates: --rc bumps to the next version with an -rc.N suffix
// (rc.1, rc.2, ... while iterating). The final stable release afterwards
// drops the suffix and generates the CHANGELOG.md section from the last stable
// tag, so rc iterations never fragment the release notes.
//
// Usage:
//   npm run release            # dispatch a stable release (CI runs this script)
//   npm run release:rc         # dispatch a vX.Y.Z-rc.N prerelease
//   npm run release:dry        # local preview: what would happen, no changes
//   npm run release:dry -- --rc

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
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

  // 3. push main + tag. The rest of the workflow run builds the dmg and
  //    creates + publishes the GitHub Release for this tag.
  sh(["git", "push", "origin", "main"]);
  sh(["git", "push", "origin", tag]);

  // Hand the tag to the next workflow jobs (no-op outside GitHub Actions).
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
  }

  console.log(`[release] ✓ pushed ${tag} — the workflow will build and publish the release`);
}

main().catch((err) => {
  console.error("[release] failed:", err);
  process.exit(1);
});
