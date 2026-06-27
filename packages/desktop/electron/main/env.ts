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

/** The bundled extension passed to `pi -e`. Loaded as JS in both dev and
 *  packaged (Electron-as-Node can't parse the TS source); produced by
 *  scripts/bundle-extension.ts. */
export function extensionPath(): string {
  return path.join(resourceDir(), "accountant24-extension.js");
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
  const bin = path.join(res, "bin");
  if (existsSync(bin)) env.PATH = `${bin}${path.delimiter}${env.PATH ?? ""}`;
  const tessdata = path.join(res, "tessdata");
  if (existsSync(tessdata)) env.TESSDATA_PREFIX = tessdata;
  return env;
}
