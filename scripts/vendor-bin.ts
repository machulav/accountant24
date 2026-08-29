// Vendors the external CLI tools the app shells out to (hledger, pdftotext,
// tesseract, uv) into packages/desktop/resources so electron-builder bundles
// them into Contents/Resources. Run on the matching-arch macOS runner BEFORE
// the build — it installs the brew tools via Homebrew, relocates their
// non-system dylibs next to the binaries (so they run on a user Mac without
// Homebrew), downloads the pinned uv release and verifies its checksum, copies
// the English OCR data, ad-hoc signs everything (required for arm64 to launch
// while the app is unsigned), and writes THIRD-PARTY-LICENSES.txt so the
// bundled GPL tools (hledger, poppler) ship with their license +
// corresponding-source offer. Developer-ID re-signing happens later in the
// electron-builder signing pass.
//
// Usage: tsx scripts/vendor-bin.ts

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RES = join(ROOT, "packages", "desktop", "resources");
const BIN = join(RES, "bin");
const LIB = join(BIN, "lib");
const TESSDATA = join(RES, "tessdata");
const LICENSES = join(RES, "THIRD-PARTY-LICENSES.txt");

/** Run a command, inheriting stdio; throw on non-zero. */
function run(cmd: string, args: string[], opts: { input?: string } = {}): void {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: opts.input ? ["pipe", "inherit", "inherit"] : "inherit", input: opts.input });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`Command failed (${r.status}): ${cmd} ${args.join(" ")}`);
}

/** Run a command and return trimmed stdout. */
function capture(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`Command failed (${r.status}): ${cmd} ${args.join(" ")}`);
  return (r.stdout ?? "").trim();
}

// formula → executable name to vendor.
const TOOLS = [
  { formula: "hledger", exe: "hledger" },
  { formula: "poppler", exe: "pdftotext" },
  { formula: "tesseract", exe: "tesseract" },
];

// uv runs plugin helper scripts (`uv run scripts/foo.py`, with a PEP 723
// header naming the Python version and packages) and downloads a managed
// Python into the workspace on first use — the app bundles uv, not Python.
// Not a brew formula: Astral publishes one self-contained binary per target
// (system libraries only, so no dylib relocation), pinned here by version and
// by the sha256 of the release asset. Only the Apple Silicon build is pinned,
// since that is the only target the app ships (see electron-builder.yml);
// bumping uv means editing the version and the hash together.
const UV_VERSION = "0.12.7";
const UV_TARGET = "aarch64-apple-darwin";
const UV_SHA256 = "127ebdda7ad953cdf198e964b570ea5771b85467ea93eb7cb6d6f8e6f55408f3";

/** GET a URL into memory (release assets redirect to a CDN; fetch follows).
 *  GitHub answers with a 5xx now and then; three tries before giving up. */
async function download(url: string, attempts = 3): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url).catch((err: unknown) => err as Error);
    if (!(res instanceof Error) && res.ok) return Buffer.from(await res.arrayBuffer());
    const reason = res instanceof Error ? res.message : `${res.status} ${res.statusText}`;
    if (attempt >= attempts || (!(res instanceof Error) && res.status < 500)) {
      throw new Error(`Failed to download ${url}: ${reason}`);
    }
    console.log(`[vendor-bin] ${reason} for ${url}, retrying (${attempt}/${attempts})`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

/** Download the pinned uv release, verify its sha256, and put the `uv`
 *  binary (not `uvx`, which the app never calls) into BIN. Returns the
 *  vendored path so it gets signed with the other binaries. */
async function vendorUv(): Promise<string> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(`uv ${UV_VERSION} is pinned for ${UV_TARGET} only, got ${process.platform}-${process.arch}`);
  }
  const asset = `uv-${UV_TARGET}.tar.gz`;
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`;
  console.log(`[vendor-bin] uv ${UV_VERSION} (${asset})`);

  const buf = await download(url);
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== UV_SHA256) {
    throw new Error(`SHA256 mismatch for ${asset}: expected ${UV_SHA256}, got ${actual}`);
  }

  // The archive holds one folder, uv-<target>/, with uv and uvx inside.
  const tmp = mkdtempSync(join(tmpdir(), "a24-uv-"));
  try {
    const archive = join(tmp, asset);
    writeFileSync(archive, buf);
    run("tar", ["xzf", archive, "-C", tmp]);
    const src = join(tmp, `uv-${UV_TARGET}`, "uv");
    if (!existsSync(src)) throw new Error(`Expected uv inside ${asset}`);
    const dest = join(BIN, "uv");
    copyFileSync(src, dest);
    chmodSync(dest, 0o755);
    const version = capture(dest, ["--version"]);
    if (!version.startsWith(`uv ${UV_VERSION}`)) throw new Error(`Vendored uv reports "${version}"`);
    return dest;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** uv's license text (dual MIT / Apache-2.0; the MIT text is embedded, the
 *  Apache one is a link away at the same tag) for THIRD-PARTY-LICENSES.txt. */
async function uvLicenseText(): Promise<string> {
  const buf = await download(`https://raw.githubusercontent.com/astral-sh/uv/${UV_VERSION}/LICENSE-MIT`);
  return buf.toString("utf8").trim();
}

type BrewMeta = { version: string; license: string; source: string; homepage: string };

/** Read metadata (version, SPDX license, source URL) for formulae in one call. */
function brewInfo(formulae: string[]): Map<string, BrewMeta> {
  const json = JSON.parse(capture("brew", ["info", "--json=v2", ...formulae]));
  const out = new Map<string, BrewMeta>();
  for (const f of json.formulae ?? []) {
    out.set(f.name, {
      version: f.versions?.stable ?? "unknown",
      license: f.license ?? "see source",
      source: f.urls?.stable?.url ?? f.homepage ?? "",
      homepage: f.homepage ?? "",
    });
  }
  return out;
}

/** Best-effort: the first LICENSE/COPYING/NOTICE file Homebrew installed for a
 *  formula, so we can embed the verbatim text. */
function licenseText(formula: string): string {
  const prefix = capture("brew", ["--prefix", formula]);
  const found = capture("bash", [
    "-c",
    `find -L "${prefix}" -maxdepth 4 -type f \\( -iname 'LICENSE*' -o -iname 'COPYING*' -o -iname 'NOTICE*' \\) 2>/dev/null | head -n1`,
  ]);
  return found ? readFileSync(found, "utf8").trim() : "";
}

/** Write THIRD-PARTY-LICENSES.txt: per-tool version + SPDX + corresponding-source
 *  URL + license text, plus an appendix of the bundled shared libraries. */
function writeLicenses(uvLicense: string): void {
  const meta = brewInfo(TOOLS.map((t) => t.formula));
  const lines: string[] = [
    "Accountant24 — Third-Party Licenses",
    "",
    "This application bundles the command-line tools below. Their full license text",
    "follows each entry, and the corresponding source for the exact bundled version",
    "is available at the listed URL (this is the GPL written offer of source).",
    "",
  ];
  for (const { formula, exe } of TOOLS) {
    const m = meta.get(formula);
    const text = licenseText(formula);
    lines.push(
      "================================================================",
      `${formula} (${exe}) ${m?.version ?? "?"} — ${m?.license ?? "?"}`,
      `Project: ${m?.homepage ?? ""}`,
      `Corresponding source: ${m?.source ?? ""}`,
      "----------------------------------------------------------------",
      text || `(Full license text: see the source above; SPDX: ${m?.license ?? "?"}.)`,
      "",
    );
  }
  // Not a brew formula, so its metadata is pinned here with the binary.
  lines.push(
    "================================================================",
    `uv (uv) ${UV_VERSION} — MIT OR Apache-2.0`,
    "Project: https://github.com/astral-sh/uv",
    `Corresponding source: https://github.com/astral-sh/uv/releases/tag/${UV_VERSION}`,
    "----------------------------------------------------------------",
    uvLicense,
    "",
    `(Also available under Apache-2.0: https://github.com/astral-sh/uv/blob/${UV_VERSION}/LICENSE-APACHE)`,
    "",
  );
  const libs = existsSync(LIB) ? readdirSync(LIB).filter((f) => f.endsWith(".dylib")) : [];
  lines.push(
    "================================================================",
    "Bundled shared libraries",
    "----------------------------------------------------------------",
    "These dynamic libraries are dependencies of the tools above and are",
    "redistributed under their respective upstream open-source licenses, with",
    "corresponding source available from each project (see the tool sources above):",
    "",
    ...libs.map((f) => `  - ${f}`),
    "",
  );
  writeFileSync(LICENSES, lines.join("\n"));
  console.log(`[vendor-bin] wrote ${LICENSES} (${libs.length} bundled libs listed)`);
}

async function main() {
  console.log(`[vendor-bin] arch=${process.arch}`);

  // Start from a clean bin/ (keep the tracked README.md) and lib/.
  if (existsSync(LIB)) rmSync(LIB, { recursive: true, force: true });
  mkdirSync(LIB, { recursive: true });
  mkdirSync(TESSDATA, { recursive: true });

  // 1. Install the tools + dylibbundler (idempotent on the runner).
  run("brew", ["install", "hledger", "poppler", "tesseract", "dylibbundler"]);

  // 2. Copy each binary in, then relocate its non-system dylibs into bin/lib and
  //    rewrite the load paths to @executable_path/lib. dylibbundler cannot resolve
  //    @rpath/... install names (e.g. pdftotext → @rpath/libpoppler.NNN.dylib) by
  //    itself, so point it at the formula's lib dir via --search-path. stdin is
  //    /dev/null: on any unresolved dependency dylibbundler prompts interactively,
  //    which in CI turns into an infinite retry loop — fail the step instead.
  const bins: string[] = [];
  for (const { formula, exe } of TOOLS) {
    const prefix = capture("brew", ["--prefix", formula]);
    const src = join(prefix, "bin", exe);
    if (!existsSync(src)) throw new Error(`Expected ${exe} at ${src} after brew install`);
    const dest = join(BIN, exe);
    copyFileSync(src, dest);
    bins.push(dest);
    run("bash", [
      "-c",
      // Quote the interpolated paths — a checkout under a directory with spaces
      // would otherwise split them into multiple arguments.
      `dylibbundler --bundle-deps --overwrite-files --create-dir ` +
        `--dest-dir "${LIB}" --install-path @executable_path/lib ` +
        `--search-path "${join(prefix, "lib")}" --fix-file "${dest}" < /dev/null`,
    ]);
  }

  // 3. uv: a pinned GitHub release, checksum-verified, no relocation needed.
  bins.push(await vendorUv());

  // 4. English OCR data (the app points TESSDATA_PREFIX at resources/tessdata).
  const tessShare = join(capture("brew", ["--prefix", "tesseract"]), "share", "tessdata");
  const eng = join(tessShare, "eng.traineddata");
  if (!existsSync(eng)) throw new Error(`eng.traineddata not found at ${eng}`);
  copyFileSync(eng, join(TESSDATA, "eng.traineddata"));

  // 5. Ad-hoc sign the relocated dylibs first, then the binaries, so they launch
  //    on arm64 (Developer-ID re-signing happens later, with notarization).
  const dylibs = readdirSync(LIB).filter((f) => f.endsWith(".dylib")).map((f) => join(LIB, f));
  for (const f of [...dylibs, ...bins]) run("codesign", ["--force", "--sign", "-", f]);

  // 6. Emit the third-party license notice for the bundled GPL/permissive tools.
  writeLicenses(await uvLicenseText());

  console.log(`[vendor-bin] ✓ vendored ${TOOLS.map((t) => t.exe).join(", ")}, uv + eng.traineddata + licenses`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
