// Vendors the external CLI tools the app shells out to (hledger, pdftotext,
// tesseract, python3) into packages/desktop/resources so electron-builder
// bundles them into Contents/Resources. Run on the matching-arch macOS runner
// BEFORE the build - it installs the brew tools, relocates their non-system
// dylibs next to the binaries (so they run on a user Mac without Homebrew),
// downloads a pinned python-build-standalone interpreter (self-contained,
// no relocation needed - see vendorPython() below), copies the English OCR
// data, ad-hoc signs everything (required for arm64 to launch while the app
// is unsigned), and writes THIRD-PARTY-LICENSES.txt so the bundled GPL/PSF
// tools ship with their license + corresponding-source offer. Developer-ID
// re-signing happens later in the electron-builder signing pass.
//
// Usage: tsx scripts/vendor-bin.ts

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RES = join(ROOT, "packages", "desktop", "resources");
const BIN = join(RES, "bin");
const LIB = join(BIN, "lib");
const TESSDATA = join(RES, "tessdata");
const LICENSES = join(RES, "THIRD-PARTY-LICENSES.txt");

// python-build-standalone (the same relocatable-CPython project uv/rye embed)
// pinned by exact release tag + version + checksum, since - unlike the brew
// formulae above - nothing here resolves "latest" for us; bumping the
// interpreter is a deliberate edit to these constants, not an automatic pickup.
// "install_only_stripped" build: debug symbols stripped, and per `otool -L`
// only links system frameworks/libs (no Homebrew Cellar deps), so it needs no
// dylibbundler relocation - unlike the brew tools below.
const PYTHON_RELEASE_TAG = "20260718";
const PYTHON_VERSION = "3.12.13";
const PYTHON_MINOR = "3.12";
const PYTHON_ASSET = `cpython-${PYTHON_VERSION}+${PYTHON_RELEASE_TAG}-aarch64-apple-darwin-install_only_stripped.tar.gz`;
const PYTHON_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE_TAG}/${PYTHON_ASSET}`;
const PYTHON_SHA256 = "9a1e9e06175c10efd8378b904b07fa21bd791ab3345d7cdffeb4a76c9ff55903";
const PYTHON_DIR = join(BIN, "python");

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

/** Download the pinned python-build-standalone tarball, verify its checksum,
 *  extract it to BIN/python (bin/lib/include/share, stdlib-relative-path
 *  relocatable by design), prune what a stdlib-only script never needs, and
 *  ad-hoc sign the interpreter + its one dylib. */
async function vendorPython(): Promise<void> {
  // PYTHON_ASSET is pinned to an aarch64-apple-darwin build, matching this
  // repo's arm64-only mac target (see electron-builder.yml). Re-pin (or
  // vendor per-arch) before re-adding an x64 build - an x64 app would
  // otherwise silently ship an arm64 interpreter that can't execute.
  if (process.arch !== "arm64") throw new Error(`vendorPython() only supports arm64, got process.arch=${process.arch}`);

  console.log(`[vendor-bin] python ${PYTHON_VERSION} (${PYTHON_RELEASE_TAG})`);
  if (existsSync(PYTHON_DIR)) rmSync(PYTHON_DIR, { recursive: true, force: true });

  const res = await fetch(PYTHON_URL);
  if (!res.ok) throw new Error(`Failed to download ${PYTHON_URL}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== PYTHON_SHA256) {
    throw new Error(`SHA256 mismatch for ${PYTHON_ASSET}: expected ${PYTHON_SHA256}, got ${actual}`);
  }

  // The tarball's top-level entry is "python/" - extracting into BIN lands it
  // directly at PYTHON_DIR.
  const tmpTar = join(BIN, "_python.tar.gz");
  writeFileSync(tmpTar, buf);
  run("tar", ["xzf", tmpTar, "-C", BIN]);
  rmSync(tmpTar);

  // Trim what a stdlib-only script (no pip install, no GUI, no C-extension
  // builds) never needs: pip/ensurepip, idle/tkinter (+ the Tcl/Tk dylibs
  // those pull in) and lib2to3 (GUI/legacy), and headers/docs.
  const prune = [
    `lib/python${PYTHON_MINOR}/site-packages`,
    `lib/python${PYTHON_MINOR}/ensurepip`,
    `lib/python${PYTHON_MINOR}/idlelib`,
    `lib/python${PYTHON_MINOR}/tkinter`,
    `lib/python${PYTHON_MINOR}/turtledemo`,
    `lib/python${PYTHON_MINOR}/lib2to3`,
    "lib/tcl9.0",
    "lib/tk9.0",
    "lib/itcl4.3.5",
    "lib/thread3.0.4",
    "lib/libtcl9.0.dylib",
    "lib/libtcl9tk9.0.dylib",
    "include",
    "share",
    "bin/idle3",
    `bin/idle3.${PYTHON_MINOR.split(".")[1]}`,
    "bin/2to3",
    `bin/2to3-${PYTHON_MINOR}`,
    "bin/pip",
    "bin/pip3",
    `bin/pip3.${PYTHON_MINOR.split(".")[1]}`,
    "bin/python3-config",
    `bin/python${PYTHON_MINOR}-config`,
  ];
  for (const rel of prune) rmSync(join(PYTHON_DIR, rel), { recursive: true, force: true });

  const pyBin = join(PYTHON_DIR, "bin", `python${PYTHON_MINOR}`);
  const pyDylib = join(PYTHON_DIR, "lib", `libpython${PYTHON_MINOR}.dylib`);
  for (const f of [pyDylib, pyBin]) run("codesign", ["--force", "--sign", "-", f]);
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
function writeLicenses(): void {
  const meta = brewInfo(TOOLS.map((t) => t.formula));
  const lines: string[] = [
    "Accountant24 — Third-Party Licenses",
    "",
    "This application bundles the command-line tools below. Their full license text",
    "follows each entry, and the corresponding source for the exact bundled version",
    "is available at the listed URL (for the GPL-licensed tools, this is the written",
    "offer of source).",
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
  // Not a brew formula, so it gets its own hardcoded metadata block rather
  // than coming from brewInfo().
  lines.push(
    "================================================================",
    `python (python3) ${PYTHON_VERSION} - PSF-2.0`,
    "Project: https://www.python.org/",
    `Corresponding source: https://github.com/astral-sh/python-build-standalone/releases/tag/${PYTHON_RELEASE_TAG}`,
    "----------------------------------------------------------------",
    "(Full license text: see the source above; SPDX: PSF-2.0. Vendored as a",
    "python-build-standalone build, a redistributable CPython + stdlib.)",
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

  // 3. English OCR data (the app points TESSDATA_PREFIX at resources/tessdata).
  const tessShare = join(capture("brew", ["--prefix", "tesseract"]), "share", "tessdata");
  const eng = join(tessShare, "eng.traineddata");
  if (!existsSync(eng)) throw new Error(`eng.traineddata not found at ${eng}`);
  copyFileSync(eng, join(TESSDATA, "eng.traineddata"));

  // 4. Ad-hoc sign the relocated dylibs first, then the binaries, so they launch
  //    on arm64 (Developer-ID re-signing happens later, with notarization).
  const dylibs = readdirSync(LIB).filter((f) => f.endsWith(".dylib")).map((f) => join(LIB, f));
  for (const f of [...dylibs, ...bins]) run("codesign", ["--force", "--sign", "-", f]);

  // 5. Python: downloaded + verified + pruned + signed separately (no brew
  //    formula, no dylib relocation needed - see vendorPython()).
  await vendorPython();

  // 6. Emit the third-party license notice for the bundled GPL/PSF tools.
  writeLicenses();

  console.log(`[vendor-bin] vendored ${TOOLS.map((t) => t.exe).join(", ")}, python, eng.traineddata + licenses`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
