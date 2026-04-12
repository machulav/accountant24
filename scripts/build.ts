#!/usr/bin/env bun
// Build orchestrator for standalone `accountant24` binaries via `bun build --compile`.
// Produces release/<target>/{accountant24, package.json, theme/, export-html/}
// and a matching release/accountant24-<platform>.tar.gz tarball.
// The executable is named `accountant24` (primary command); the Homebrew
// formula adds `a24` as a symlink alias to the same binary.
//
// Usage:
//   bun run build                         # host platform
//   TARGET=bun-darwin-x64 bun run build   # cross-compile
//   bun run build --all                   # build all four targets

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = join(ROOT, "release");
const PI = join(ROOT, "node_modules", "@mariozechner", "pi-coding-agent");

const ALL_TARGETS = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-x64",
  "bun-linux-arm64",
] as const;
type Target = (typeof ALL_TARGETS)[number];

/** Platform label used in tarball filenames (strips the `bun-` prefix). */
function platformLabel(target: Target): string {
  return target.replace(/^bun-/, "");
}

async function run(cmd: string[], cwd = ROOT): Promise<void> {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`Command failed (${code}): ${cmd.join(" ")}`);
}

async function buildTarget(target: Target, version: string): Promise<string> {
  const targetDir = join(RELEASE, target);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  // 1. compile
  console.log(`[build] compiling ${target}`);
  await run([
    "bun",
    "build",
    "--compile",
    "--minify",
    "--sourcemap",
    `--target=${target}`,
    "src/index.ts",
    "--outfile",
    join(targetDir, "accountant24"),
  ]);

  // 2. stage sidecars expected by pi-coding-agent
  // see node_modules/@mariozechner/pi-coding-agent/dist/config.js:63-85
  console.log(`[build] staging sidecars for ${target}`);
  stageSidecar(join(ROOT, "package.json"), join(targetDir, "package.json"));
  stageSidecar(join(PI, "dist", "modes", "interactive", "theme"), join(targetDir, "theme"));
  stageSidecar(join(PI, "dist", "core", "export-html"), join(targetDir, "export-html"));

  // 3. package tarball — named `accountant24-<platform>.tar.gz` to match
  //    the Homebrew package name; the binary inside is still `a24`.
  const tarballName = `accountant24-${platformLabel(target)}.tar.gz`;
  const tarballPath = join(RELEASE, tarballName);
  console.log(`[build] packaging ${tarballName}`);
  await run(["tar", "-czf", tarballPath, "-C", targetDir, "."]);

  console.log(`[build] ✓ ${target} (version ${version})`);
  return tarballPath;
}

function stageSidecar(from: string, to: string): void {
  if (!existsSync(from)) throw new Error(`Missing sidecar source: ${from}`);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

async function generateChecksums(tarballs: string[]): Promise<void> {
  const shaTool = Bun.which("sha256sum") ?? (Bun.which("shasum") ? "shasum" : null);
  if (!shaTool) {
    console.warn("[build] neither sha256sum nor shasum found — skipping SHA256SUMS");
    return;
  }
  const args = shaTool.endsWith("shasum") ? ["-a", "256"] : [];
  const lines: string[] = [];
  for (const t of tarballs) {
    const filename = t.split("/").pop() ?? t;
    const proc = Bun.spawn([shaTool, ...args, filename], { cwd: RELEASE, stdout: "pipe" });
    const out = await new Response(proc.stdout).text();
    lines.push(out.trim());
    await proc.exited;
  }
  writeFileSync(join(RELEASE, "SHA256SUMS"), `${lines.join("\n")}\n`);
  console.log("[build] wrote SHA256SUMS");
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

async function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const version: string = pkg.version;

  const buildAll = process.argv.includes("--all");
  const envTarget = process.env.TARGET as Target | undefined;

  const targets: Target[] = buildAll
    ? [...ALL_TARGETS]
    : envTarget
      ? [envTarget]
      : [resolveHostTarget()];

  if (!existsSync(PI)) {
    throw new Error(`pi-coding-agent not found at ${PI}. Run \`bun install\` first.`);
  }

  mkdirSync(RELEASE, { recursive: true });
  const tarballs: string[] = [];
  for (const target of targets) {
    tarballs.push(await buildTarget(target, version));
  }
  if (tarballs.length > 1) {
    await generateChecksums(tarballs);
  }
  console.log(`[build] done (${targets.length} target${targets.length === 1 ? "" : "s"})`);
}

main().catch((err) => {
  console.error("[build] failed:", err);
  process.exit(1);
});
