// The session-file path guard shared by the agent child manager (the path
// becomes a spawn argument) and the sessions IPC (an rmSync target). One
// security-relevant containment check, one place to harden.

import { resolve, sep } from "node:path";
import { sessionsDir } from "../env";

/** Resolve a session path strictly inside the sessions dir, or null when it
 *  falls outside. The separator suffix stops both siblings that merely share
 *  the prefix (…/sessions-backup) and the dir itself. */
export function resolveSessionPath(sessionPath: string): string | null {
  const dir = resolve(sessionsDir());
  const target = resolve(sessionPath);
  return target.startsWith(dir + sep) ? target : null;
}
