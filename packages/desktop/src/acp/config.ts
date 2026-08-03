// Config for the ACP process, resolved without Electron.
//
// main/env.ts gets the resource dir from Electron's `app`; here it comes from
// the launcher via ACCOUNTANT24_RESOURCES, falling back to a probe relative to
// this module so `node out/main/acp.js` works in dev too.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  agentEnv,
  agentHostConfig,
  type ResourcePaths,
  resourcePaths,
  type WorkspacePaths,
  workspacePaths,
} from "../main/agent/host/workspace";
import { readAppSettings } from "../main/app-settings";
import type { AgentHostConfig } from "../shared/agentHost";

export interface AcpConfig {
  workspace: WorkspacePaths;
  resources: ResourcePaths;
  host: AgentHostConfig;
  /** `provider/modelId` the user picked in the app, when set. */
  defaultModel: string | undefined;
  /** Model ids the user enabled in the app; empty/undefined means all. */
  enabledModels: string[] | undefined;
  /** Reported to the client in `agentInfo`. */
  version: string;
}

/** A resource dir is the real one if it holds the assets the agent needs. */
function looksLikeResourceDir(dir: string): boolean {
  return existsSync(`${dir}/system.md`) && existsSync(`${dir}/accountant24-extension.js`);
}

/**
 * Where the vendored tools, extension bundle and system prompt live.
 *
 * The launcher exports ACCOUNTANT24_RESOURCES, so the probe below only matters
 * when running the built entry directly. Two layouts:
 *
 *   dev       packages/desktop/out/main/acp.js         → ../../resources
 *   packaged  …/Contents/Resources/app/out/main/acp.js → ../../..
 *
 * (asar is disabled, so the packaged app tree really is on disk under app/.)
 */
export function resolveResourceDir(moduleUrl: string = import.meta.url): string {
  const fromEnv = process.env.ACCOUNTANT24_RESOURCES;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const candidates = ["../../resources", "../../.."].map((rel) =>
    fileURLToPath(new URL(rel, moduleUrl)).replace(/(.)\/$/, "$1"),
  );
  return candidates.find(looksLikeResourceDir) ?? candidates[0];
}

/** The app version, read from the package.json two levels above the built entry. */
function readVersion(moduleUrl: string): string {
  try {
    const pkg = fileURLToPath(new URL("../../package.json", moduleUrl));
    const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Resolve everything the ACP server needs AND make this process look like the
 * agent host: same env, same working directory.
 *
 * Both are load bearing, not cosmetic.
 *
 * The env: the extension spawns bare `hledger`, `pdftotext` and `tesseract`, so
 * without the vendored bin/ on PATH and TESSDATA_PREFIX set they silently
 * resolve to a system install or throw.
 *
 * The cwd: an ACP client spawns us from wherever it likes (Buzz uses ~/.buzz),
 * but pi stamps `process.cwd()` into the header of every new session file, and
 * `SessionManager.list(cwd, sessionDir)` filters on that header. Leave it alone
 * and chats started over ACP never show up in the app's chat list. The desktop
 * app gets this for free by forking the agent host with cwd set to the
 * workspace; here we have to adopt it ourselves.
 *
 * All of it must happen before the pi runtime loads the extension.
 */
export function loadAcpConfig(moduleUrl: string = import.meta.url): AcpConfig {
  const resources = resourcePaths(resolveResourceDir(moduleUrl));
  const workspace = workspacePaths();

  const env = agentEnv(workspace, resources);
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") process.env[key] = value;
  }

  mkdirSync(workspace.sessionsDir, { recursive: true });
  process.chdir(workspace.workspaceDir);

  const settings = readAppSettings(workspace);
  return {
    workspace,
    resources,
    host: agentHostConfig(workspace, resources),
    defaultModel: settings.defaultModel,
    enabledModels: settings.enabledModels,
    version: readVersion(moduleUrl),
  };
}
