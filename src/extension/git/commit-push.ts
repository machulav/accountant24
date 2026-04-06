import { ACCOUNTANT24_HOME } from "../config";
import { commitAll, diffStat, hasRemotes, push } from "./git";

export interface CommitAndPushResult {
  status: "committed" | "no_changes";
  /** Meaningful files that were committed (excludes sessions/) */
  committedFiles: string[];
  commitMessage: string;
  pushed: boolean;
}

export async function commitAndPush(message: string, cwd = ACCOUNTANT24_HOME): Promise<CommitAndPushResult> {
  const files = await diffStat(cwd);
  const meaningful = files.filter((f) => !f.startsWith("sessions/"));
  if (meaningful.length === 0) return { status: "no_changes", committedFiles: [], commitMessage: "", pushed: false };

  await commitAll(cwd, message);

  let pushed = false;
  if (await hasRemotes(cwd)) {
    await push(cwd);
    pushed = true;
  }

  return { status: "committed", committedFiles: meaningful, commitMessage: message, pushed };
}
