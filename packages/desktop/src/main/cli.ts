// The command-line flags the app accepts. Today that is one: `--workspace`.
//
// Which folder is the workspace is decided once per launch, in this order: the
// `--workspace <path>` flag, then the ACCOUNTANT24_WORKSPACE env var, then the
// default (~/.accountant24, see env.ts). The flag is exported into
// ACCOUNTANT24_WORKSPACE so that one env var stays the single channel every
// consumer reads. Parsing scans process.argv itself: Electron's
// app.commandLine only understands the `--flag=value` form and is documented
// as not meant for application flags.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type WorkspaceSource = "flag" | "env" | "default";

const WORKSPACE_FLAG = "--workspace";

/** Find `--workspace <path>` / `--workspace=<path>` in argv. The last
 *  occurrence wins; every other switch (Electron's, Chromium's) is ignored. A
 *  flag without a usable value is an error, never a silent fallback to another
 *  folder: this is a finance app, opening the wrong workspace is worse than
 *  not opening. */
export function parseWorkspaceFlag(argv: readonly string[]): { path: string } | { error: string } | undefined {
  const missing = { error: `${WORKSPACE_FLAG} needs a folder path, e.g. ${WORKSPACE_FLAG} ~/Demo` };
  let result: { path: string } | { error: string } | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === WORKSPACE_FLAG) {
      const value = argv[i + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        result = missing;
      } else {
        result = { path: value };
        i++;
      }
    } else if (arg.startsWith(`${WORKSPACE_FLAG}=`)) {
      const value = arg.slice(WORKSPACE_FLAG.length + 1);
      result = value === "" ? missing : { path: value };
    }
  }
  return result;
}

/** Apply the `--workspace` flag to this process: expand `~`, make the path
 *  absolute, and export it as ACCOUNTANT24_WORKSPACE so workspaceDir() and every
 *  child process agree. Returns where the workspace comes from. Throws a
 *  user-facing Error for a malformed flag or a path that exists but is not a
 *  directory; a folder that does not exist yet is fine (workspace setup
 *  creates it). */
export function applyWorkspaceFlag(argv: readonly string[] = process.argv): WorkspaceSource {
  const flag = parseWorkspaceFlag(argv);
  if (flag === undefined) {
    const env = process.env.ACCOUNTANT24_WORKSPACE;
    return env && env.length > 0 ? "env" : "default";
  }
  if ("error" in flag) throw new Error(flag.error);
  const expanded =
    flag.path === "~" || flag.path.startsWith("~/") ? path.join(homedir(), flag.path.slice(1)) : flag.path;
  const resolved = path.resolve(expanded);
  if (existsSync(resolved) && !statSync(resolved).isDirectory()) {
    throw new Error(`${WORKSPACE_FLAG} must point to a folder, but ${resolved} is a file`);
  }
  process.env.ACCOUNTANT24_WORKSPACE = resolved;
  return "flag";
}
