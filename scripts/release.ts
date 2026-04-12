#!/usr/bin/env bun
// End-to-end release orchestrator:
//   1. sanity: working tree clean, on main, `gh` authenticated
//   2. bump version + generate changelog + tag (changelogen)
//   3. build all four binaries into release/
//   4. push main + tag
//   5. create GitHub Release with tarballs + SHA256SUMS
//   6. re-render Homebrew formula from template and push to tap repo
//
// Usage:
//   bun run release            # full release
//   bun run release:dry        # show what would happen, no state changes
//
// Env vars:
//   A24_TAP_REPO   git URL of the tap (default: git@github.com:machulav/homebrew-tap.git)
//   A24_TAP_LOCAL  local checkout path (default: ../homebrew-tap)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const TAP_REPO = process.env.A24_TAP_REPO ?? "git@github.com:machulav/homebrew-tap.git";
const TAP_LOCAL = process.env.A24_TAP_LOCAL ?? join(ROOT, "..", "homebrew-tap");

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

const TARBALLS = [
  "accountant24-darwin-arm64.tar.gz",
  "accountant24-darwin-x64.tar.gz",
  "accountant24-linux-x64.tar.gz",
  "accountant24-linux-arm64.tar.gz",
] as const;

async function main() {
  // 1. preflight checks
  const status = await sh(["git", "status", "--porcelain"], { capture: true, allowDry: true });
  if (status.length > 0) throw new Error(`Working tree not clean:\n${status}`);

  const branch = await sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    capture: true,
    allowDry: true,
  });
  if (branch !== "main") throw new Error(`Must release from main (currently on ${branch})`);

  await sh(["gh", "auth", "status"], { allowDry: true });

  // 2. capture release notes from changelogen (display-only mode outputs to stdout)
  const rawMarkdown = await sh(["bunx", "changelogen"], { capture: true, allowDry: true });
  const releaseNotes = rawMarkdown.split("\n").slice(2).join("\n").trim();

  // 3. bump version + write CHANGELOG.md + commit + tag via changelogen
  //    We do NOT pass --push; push happens after a successful build so a build
  //    failure can be rolled back with `git reset --hard HEAD~1 && git tag -d`.
  await sh(["bunx", "changelogen", "--release"]);

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const version: string = pkg.version;
  const tag = `v${version}`;
  console.log(`[release] staged ${tag}`);

  // 4. build all four binaries with the bumped version baked in
  await sh(["bun", "run", "scripts/build.ts", "--all"]);

  // 5. push main + tag
  await sh(["git", "push", "origin", "main"]);
  await sh(["git", "push", "origin", tag]);

  // 6. create GitHub Release with tarballs + changelog notes
  await sh([
    "gh",
    "release",
    "create",
    tag,
    "--title",
    tag,
    "--notes",
    releaseNotes,
    ...TARBALLS.map((t) => join(ROOT, "release", t)),
    join(ROOT, "release", "SHA256SUMS"),
  ]);

  // 7. update Homebrew tap
  await updateBrewTap(version);

  console.log(`[release] ✓ ${tag} published`);
}

async function updateBrewTap(version: string): Promise<void> {
  // read SHAs from release/SHA256SUMS (one line per file: "<sha>  <filename>")
  const sums = readFileSync(join(ROOT, "release", "SHA256SUMS"), "utf-8");
  const shaMap = new Map<string, string>();
  for (const line of sums.split("\n")) {
    const m = line.match(/^([a-f0-9]+)\s+\*?(accountant24-\S+\.tar\.gz)$/);
    if (m) shaMap.set(m[2], m[1]);
  }
  for (const name of TARBALLS) {
    if (!shaMap.has(name)) throw new Error(`Missing SHA for ${name} in SHA256SUMS`);
  }

  // ensure tap checkout exists
  if (!existsSync(join(TAP_LOCAL, ".git"))) {
    console.log(`[release] cloning tap into ${TAP_LOCAL}`);
    await sh(["git", "clone", TAP_REPO, TAP_LOCAL]);
  }
  await sh(["git", "-C", TAP_LOCAL, "pull", "--ff-only"]);

  // render formula from template
  const tmpl = readFileSync(join(ROOT, "scripts", "accountant24.rb.template"), "utf-8");
  const rendered = tmpl
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{SHA_DARWIN_ARM64}}", shaMap.get("accountant24-darwin-arm64.tar.gz")!)
    .replaceAll("{{SHA_DARWIN_X64}}", shaMap.get("accountant24-darwin-x64.tar.gz")!)
    .replaceAll("{{SHA_LINUX_X64}}", shaMap.get("accountant24-linux-x64.tar.gz")!)
    .replaceAll("{{SHA_LINUX_ARM64}}", shaMap.get("accountant24-linux-arm64.tar.gz")!);

  const formulaPath = join(TAP_LOCAL, "Formula", "accountant24.rb");
  mkdirSync(dirname(formulaPath), { recursive: true });
  if (!DRY) writeFileSync(formulaPath, rendered);

  // commit + push
  await sh(["git", "-C", TAP_LOCAL, "add", "Formula/accountant24.rb"]);
  await sh(["git", "-C", TAP_LOCAL, "commit", "-m", `accountant24 ${version}`]);
  await sh(["git", "-C", TAP_LOCAL, "push", "origin", "HEAD"]);
}

main().catch((err) => {
  console.error("[release] failed:", err);
  process.exit(1);
});
