// Resource paths + the environment passed to the agent-host utilityProcess.
//
// The workspace (~/Accountant24) holds the ledger + auth.json + models.json;
// PATH exposes the vendored native tools (hledger/pdftotext/tesseract/python3)
// to the agent's bash/tool subprocesses; TESSDATA_PREFIX points at the OCR data.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import type { AgentHostConfig } from "../shared/agentHost";

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

/** Dir holding the vendored native tools (hledger/pdftotext/tesseract). Prepended
 *  to the agent child's PATH; also used to resolve a tool's absolute path when we
 *  run one directly from the main process (which does NOT inherit that PATH). */
export function binDir(): string {
  return path.join(resourceDir(), "bin");
}

/** bin/python/bin under binDir() - the vendored python-build-standalone
 *  interpreter (see scripts/vendor-bin.ts), so skills invoking `python3` don't
 *  depend on whatever (if anything) is on the user's own PATH. */
export function pythonBinDir(): string {
  return path.join(binDir(), "python", "bin");
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

/** Built agent-host utilityProcess entry — emitted as a sibling of the main
 *  bundle (out/main/agent-host.js) in both dev and packaged builds, so it
 *  resolves relative to this module's own URL. */
export function agentHostEntryPath(): string {
  return fileURLToPath(new URL("./agent-host.js", import.meta.url));
}

/** Static config for the agent host, passed as JSON in argv[2] at fork time. */
export function agentHostConfig(): AgentHostConfig {
  return {
    workspaceDir: workspaceDir(),
    sessionsDir: sessionsDir(),
    skillsDir: skillsDir(),
    nativeSkillsDir: nativeSkillsDir(),
    extensionPath: extensionPath(),
    systemPromptPath: systemPromptPath(),
  };
}

/** Env overrides for the agent host + in-process SDK: workspace + vendored
 *  tools. PI_CODING_AGENT_DIR is redundant for the host itself (agentDir is
 *  passed explicitly) but kept for env parity in the agent's subprocesses. */
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
  const pyBin = pythonBinDir();
  if (existsSync(pyBin)) env.PATH = `${pyBin}${path.delimiter}${env.PATH ?? ""}`;
  const tessdata = path.join(res, "tessdata");
  if (existsSync(tessdata)) env.TESSDATA_PREFIX = tessdata;
  return env;
}
