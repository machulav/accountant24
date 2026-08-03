// Resource paths + the environment passed to the agent-host utilityProcess.
//
// The workspace (~/Accountant24) holds the ledger + auth.json + models.json;
// PATH exposes the vendored native tools (hledger/pdftotext/tesseract) to the
// agent's bash/tool subprocesses; TESSDATA_PREFIX points at the OCR data.
//
// The derivation itself lives in agent/host/workspace.ts, which has no Electron
// imports so the ACP entrypoint (which runs outside Electron) can share it.
// This module is the Electron-side binding: it supplies the resource dir, which
// is the only thing `app` is needed for.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import type { AgentHostConfig } from "../shared/agentHost";
import * as workspace from "./agent/host/workspace";

/** Dir holding vendored bin/ + tessdata/ + the extension bundle.
 *  Dev: packages/desktop/resources. Packaged: the app's resources dir
 *  (electron-builder extraResources land directly under it). */
function resourceDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources");
}

const ws = (): workspace.WorkspacePaths => workspace.workspacePaths();
const res = (): workspace.ResourcePaths => workspace.resourcePaths(resourceDir());

/** ~/Accountant24 — the agent's cwd and the home of the ledger/auth/models. */
export function workspaceDir(): string {
  return workspace.resolveWorkspaceDir();
}

/** ~/Accountant24/skills — one self-contained folder per installed skill
 *  (Agent Skills standard: a dir with SKILL.md). Each enabled skill is passed
 *  to the agent child via a `--skill` flag. */
export function skillsDir(): string {
  return ws().skillsDir;
}

/** ~/Accountant24/sessions — pi's session files, one JSONL per chat thread.
 *  Passed to the agent child via `--session-dir`. */
export function sessionsDir(): string {
  return ws().sessionsDir;
}

/** ~/Accountant24/ledger/main.journal — the ledger's entry point (includes the
 *  other journal files). */
export function mainJournalPath(): string {
  return ws().mainJournalPath;
}

/** ~/Accountant24/app-settings.json — app-owned settings (distinct from pi's). */
export function appSettingsPath(): string {
  return ws().appSettingsPath;
}

/** ~/Accountant24/settings.json — pi's settings file, which earlier app
 *  versions shared; read once as a migration source. */
export function legacySettingsPath(): string {
  return ws().legacySettingsPath;
}

/** Dir holding the vendored native tools (hledger/pdftotext/tesseract). Prepended
 *  to the agent child's PATH; also used to resolve a tool's absolute path when we
 *  run one directly from the main process (which does NOT inherit that PATH). */
export function binDir(): string {
  return res().binDir;
}

/** The bundled extension passed to `pi -e`. Loaded as JS in both dev and
 *  packaged (Electron-as-Node can't parse the TS source); produced by
 *  scripts/bundle-extension.ts. */
export function extensionPath(): string {
  return res().extensionPath;
}

/** The static system prompt passed to `pi --system-prompt`. pi replaces its
 *  coding-agent preamble with this file's contents but still assembles its
 *  native sections (the <available_skills> block, date/cwd) around it; the
 *  extension then appends the dynamic tools/context sections per turn. Copied
 *  next to the extension bundle by scripts/bundle-extension.ts. */
export function systemPromptPath(): string {
  return res().systemPromptPath;
}

/** Native (built-in) skills embedded in the app bundle — one folder per skill,
 *  committed under packages/desktop/resources/skills. Always loaded (a single
 *  `--skill` flag; pi recurses the directory), never present in the workspace
 *  skills folder, so users can't remove or disable them. */
export function nativeSkillsDir(): string {
  return res().nativeSkillsDir;
}

/** The ACP launcher shipped alongside the other resources — the command an
 *  external ACP client (Buzz, Zed, …) is pointed at. */
export function acpCommandPath(): string {
  return res().acpCommandPath;
}

/** Built agent-host utilityProcess entry — emitted as a sibling of the main
 *  bundle (out/main/agent-host.js) in both dev and packaged builds, so it
 *  resolves relative to this module's own URL. */
export function agentHostEntryPath(): string {
  return fileURLToPath(new URL("./agent-host.js", import.meta.url));
}

/** Static config for the agent host, passed as JSON in argv[2] at fork time. */
export function agentHostConfig(): AgentHostConfig {
  return workspace.agentHostConfig(ws(), res());
}

/** Env overrides for the agent host + in-process SDK: workspace + vendored tools. */
export function agentEnv(): NodeJS.ProcessEnv {
  return workspace.agentEnv(ws(), res());
}
