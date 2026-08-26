// Versions before 0.3 kept the default workspace at ~/Accountant24, in plain
// sight in the home folder. The default is now the hidden ~/.accountant24;
// this moves an existing folder there once, so upgraded installs keep their
// ledger, settings, sessions and git history without noticing.

import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import type { Migration } from "./runner";

export const relocateLegacyHome: Migration = {
  id: "0001-relocate-legacy-home",
  run({ workspaceDir, homeDir }) {
    // Only the default location is ours to move; a --workspace /
    // ACCOUNTANT24_WORKSPACE folder is whatever the user pointed at.
    if (workspaceDir !== path.join(homeDir, ".accountant24")) return;
    const legacy = path.join(homeDir, "Accountant24");
    // Already moved (or a fresh workspace was created meanwhile): a leftover
    // legacy folder is left alone rather than merged or deleted.
    if (existsSync(workspaceDir) || !existsSync(legacy)) return;
    renameSync(legacy, workspaceDir);
  },
};
