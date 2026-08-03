// Workspace path + env derivation, with no Electron imports.
//
// Everything here is a pure function of two inputs: the resource dir (where the
// vendored tools, extension bundle and system prompt live) and the user's home.
// Electron's `app` is the only thing that knows the resource dir, so main/env.ts
// supplies it — and the ACP entrypoint, which runs outside Electron, resolves it
// from its own module URL. Both then share this module.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { AgentHostConfig } from "../../../shared/agentHost";

// The two derivations are kept separate on purpose: workspace paths must not
// depend on the resource dir, so a caller that only wants (say) sessionsDir
// never has to resolve where the app bundle lives.

/** Paths derived from the workspace (~/Accountant24). */
export interface WorkspacePaths {
  /** The agent's cwd and the home of the ledger/auth/models. */
  workspaceDir: string;
  /** One JSONL per chat thread. */
  sessionsDir: string;
  /** One self-contained folder per installed third-party skill. */
  skillsDir: string;
  /** The ledger's entry point (includes the other journal files). */
  mainJournalPath: string;
  /** App-owned settings, distinct from pi's own settings.json. */
  appSettingsPath: string;
  /** pi's settings file, which earlier app versions shared; a migration source. */
  legacySettingsPath: string;
}

/** Paths derived from the resource dir (vendored tools + bundled agent assets). */
export interface ResourcePaths {
  /** Dir holding vendored bin/ + tessdata/ + the extension bundle. */
  resourceDir: string;
  /** Vendored native tools (hledger/pdftotext/tesseract). */
  binDir: string;
  /** The bundled extension passed to pi. */
  extensionPath: string;
  /** The static system prompt passed to pi. */
  systemPromptPath: string;
  /** Native (built-in) skills embedded in the app bundle. */
  nativeSkillsDir: string;
  /** The ACP launcher an external client is pointed at. */
  acpCommandPath: string;
}

/** ~/Accountant24, or ACCOUNTANT24_HOME when set to a non-empty path. */
export function resolveWorkspaceDir(): string {
  const env = process.env.ACCOUNTANT24_HOME;
  return env && env.length > 0 ? env : path.join(homedir(), "Accountant24");
}

export function workspacePaths(): WorkspacePaths {
  const workspaceDir = resolveWorkspaceDir();
  return {
    workspaceDir,
    sessionsDir: path.join(workspaceDir, "sessions"),
    skillsDir: path.join(workspaceDir, "skills"),
    mainJournalPath: path.join(workspaceDir, "ledger", "main.journal"),
    appSettingsPath: path.join(workspaceDir, "app-settings.json"),
    legacySettingsPath: path.join(workspaceDir, "settings.json"),
  };
}

export function resourcePaths(resourceDir: string): ResourcePaths {
  return {
    resourceDir,
    binDir: path.join(resourceDir, "bin"),
    extensionPath: path.join(resourceDir, "accountant24-extension.js"),
    systemPromptPath: path.join(resourceDir, "system.md"),
    nativeSkillsDir: path.join(resourceDir, "skills"),
    acpCommandPath: path.join(resourceDir, "accountant24-acp"),
  };
}

/** Static config for the agent host / ACP runtime factory. */
export function agentHostConfig(ws: WorkspacePaths, res: ResourcePaths): AgentHostConfig {
  return {
    workspaceDir: ws.workspaceDir,
    sessionsDir: ws.sessionsDir,
    skillsDir: ws.skillsDir,
    nativeSkillsDir: res.nativeSkillsDir,
    extensionPath: res.extensionPath,
    systemPromptPath: res.systemPromptPath,
  };
}

/** Env overrides for anything that runs the agent: workspace + vendored tools.
 *  PI_CODING_AGENT_DIR is redundant when agentDir is passed explicitly but is
 *  kept for parity in the agent's own subprocesses. */
export function agentEnv(ws: WorkspacePaths, res: ResourcePaths): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ACCOUNTANT24_HOME: ws.workspaceDir,
    PI_CODING_AGENT_DIR: ws.workspaceDir,
  };
  if (existsSync(res.binDir)) env.PATH = `${res.binDir}${path.delimiter}${env.PATH ?? ""}`;
  const tessdata = path.join(res.resourceDir, "tessdata");
  if (existsSync(tessdata)) env.TESSDATA_PREFIX = tessdata;
  return env;
}
