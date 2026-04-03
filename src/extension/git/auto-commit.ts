import { ACCOUNTANT24_HOME } from "../config";
import { commitAll, diffStat, hasRemotes, push } from "./git";

const MAX_SUBJECT = 72;

export async function autoCommitAndPush(cwd = ACCOUNTANT24_HOME): Promise<void> {
  const files = await diffStat(cwd);
  const meaningful = files.filter((f) => !f.startsWith("sessions/"));
  if (meaningful.length === 0) return;

  const message = buildCommitMessage(meaningful);
  await commitAll(cwd, message);

  if (await hasRemotes(cwd)) {
    await push(cwd);
  }
}

export function buildCommitMessage(files: string[]): string {
  const prefix = "Update ";
  const names = files.map(shortName);

  // Try joining all file names; truncate if too long
  const full = prefix + names.join(", ");
  if (full.length <= MAX_SUBJECT) return full;

  // Show as many as fit, then "+ N more"
  let msg = prefix + names[0];
  let included = 1;
  for (let i = 1; i < names.length; i++) {
    const remaining = names.length - included;
    const suffix = ` + ${remaining} more`;
    const candidate = `${msg}, ${names[i]}`;
    if (candidate.length + suffix.length > MAX_SUBJECT) {
      return msg + suffix;
    }
    msg = candidate;
    included++;
  }

  return msg;
}

function shortName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1];
}
