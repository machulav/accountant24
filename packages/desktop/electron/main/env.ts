// Resource paths + the environment passed to the pi agent child.
//
// Mirrors the old src-tauri/src/env.rs contract: the workspace (~/Accountant24)
// holds the ledger + auth.json + models.json; PATH exposes the vendored native
// tools (hledger/pdftotext/tesseract); TESSDATA_PREFIX points at the OCR data.
// pi runs from node_modules, so PI_PACKAGE_DIR is no longer needed (its assets
// sit beside it) — add it back here only if a future pi version requires it.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

/** ~/Accountant24 — the agent's cwd and the home of the ledger/auth/models. */
export function workspaceDir(): string {
  const env = process.env.ACCOUNTANT24_HOME;
  return env && env.length > 0 ? env : path.join(homedir(), "Accountant24");
}

/** ~/Accountant24/skills — one self-contained folder per installed skill
 *  (Agent Skills standard: a dir with SKILL.md). Each enabled skill is passed
 *  to the agent child via a `--skill` flag. */
export function skillsDir(): string {
  return path.join(workspaceDir(), "skills");
}

/** ~/Accountant24/sessions — pi's session files, one JSONL per chat thread.
 *  Passed to the agent child via `--session-dir`. */
export function sessionsDir(): string {
  return path.join(workspaceDir(), "sessions");
}

/** ~/Accountant24/ledger/main.journal — the ledger's entry point (includes the
 *  other journal files). */
export function mainJournalPath(): string {
  return path.join(workspaceDir(), "ledger", "main.journal");
}

/** ~/Accountant24/app-settings.json — app-owned settings (distinct from pi's). */
export function appSettingsPath(): string {
  return path.join(workspaceDir(), "app-settings.json");
}

/** ~/Accountant24/settings.json — pi's settings file, which earlier app
 *  versions shared; read once as a migration source. */
export function legacySettingsPath(): string {
  return path.join(workspaceDir(), "settings.json");
}

/** Dir holding vendored bin/ + tessdata/ + the extension bundle.
 *  Dev: packages/desktop/resources. Packaged: the app's resources dir
 *  (electron-builder extraResources land directly under it). */
function resourceDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources");
}

/** Absolute path to pi's Node CLI entry (run with Electron-as-Node). pi is
 *  ESM-only (its package "exports" has no `require` condition), so resolve via
 *  import.meta.resolve (the "." entry → dist/index.js) and take sibling cli.js. */
export function piCliPath(): string {
  const main = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return path.join(path.dirname(main), "cli.js");
}

/** Dir holding the vendored native tools (hledger/pdftotext/tesseract). Prepended
 *  to the agent child's PATH; also used to resolve a tool's absolute path when we
 *  run one directly from the main process (which does NOT inherit that PATH). */
export function binDir(): string {
  return path.join(resourceDir(), "bin");
}

/** The bundled extension passed to `pi -e`. Loaded as JS in both dev and
 *  packaged (Electron-as-Node can't parse the TS source); produced by
 *  scripts/bundle-extension.ts. */
export function extensionPath(): string {
  return path.join(resourceDir(), "accountant24-extension.js");
}

/** The static system prompt passed to `pi --system-prompt`. pi replaces its
 *  coding-agent preamble with this file's contents but still assembles its
 *  native sections (the <available_skills> block, date/cwd) around it; the
 *  extension then appends the dynamic tools/context sections per turn. Copied
 *  next to the extension bundle by scripts/bundle-extension.ts. */
export function systemPromptPath(): string {
  return path.join(resourceDir(), "system.md");
}

/** Native (built-in) skills embedded in the app bundle — one folder per skill,
 *  committed under packages/desktop/resources/skills. Always loaded (a single
 *  `--skill` flag; pi recurses the directory), never present in the workspace
 *  skills folder, so users can't remove or disable them. */
export function nativeSkillsDir(): string {
  return path.join(resourceDir(), "skills");
}

/** Binary for running pi as Node (ELECTRON_RUN_AS_NODE). On macOS, use the
 *  bundled Helper app's binary instead of the main app binary: pi touches
 *  AppKit at startup, which makes LaunchServices register the child under its
 *  bundle's Info.plist — for the main binary that's a regular app, i.e. a
 *  second (generic "exec") Dock icon. The helper bundles are LSUIElement, so
 *  the same process stays invisible. Falls back to the main binary if the
 *  helper isn't at the expected path. */
export function nodeRuntimePath(): string {
  if (process.platform !== "darwin") return process.execPath;
  // <App>.app/Contents/MacOS/<App> -> <App>.app (also matches dev's Electron.app)
  const bundle = path.resolve(process.execPath, "..", "..", "..");
  const name = path.basename(bundle, ".app");
  const helper = path.join(
    bundle,
    "Contents",
    "Frameworks",
    `${name} Helper (Plugin).app`,
    "Contents",
    "MacOS",
    `${name} Helper (Plugin)`,
  );
  return existsSync(helper) ? helper : process.execPath;
}

/** Env overrides for the pi child + in-process SDK: workspace + vendored tools. */
export function agentEnv(): NodeJS.ProcessEnv {
  const workspace = workspaceDir();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ACCOUNTANT24_HOME: workspace,
    PI_CODING_AGENT_DIR: workspace,
  };
  const res = resourceDir();
  const bin = binDir();
  if (existsSync(bin)) env.PATH = `${bin}${path.delimiter}${env.PATH ?? ""}`;
  const tessdata = path.join(res, "tessdata");
  if (existsSync(tessdata)) env.TESSDATA_PREFIX = tessdata;
  return env;
}
