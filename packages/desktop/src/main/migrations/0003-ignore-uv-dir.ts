// Plugin scripts run through the vendored uv, which downloads a managed Python
// and its package cache into <workspace>/uv (see env.ts agentEnv()). The
// workspace is a git repository and that folder is a cache worth tens of
// megabytes, so the scaffold's .gitignore lists it from now on; this adds the
// line to workspaces scaffolded before then.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Migration } from "./runner";

const IGNORE_LINE = "uv/";

export const ignoreUvDir: Migration = {
  id: "0003-ignore-uv-dir",
  run({ workspaceDir }) {
    const file = path.join(workspaceDir, ".gitignore");
    // No file yet: the workspace scaffold (workspace.ts) writes the template,
    // which already carries the line.
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8");
    if (text.split(/\r?\n/).some((line) => line.trim() === IGNORE_LINE)) return;
    const separator = text.length === 0 || text.endsWith("\n") ? "" : "\n";
    appendFileSync(file, `${separator}${IGNORE_LINE}\n`);
  },
};
