import { isAbsolute } from "node:path";
import { ACCOUNTANT24_HOME } from "../config";
import { resolveSafePath } from "../ledger/paths";

export function resolveWorkspacePath(relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(
      `Absolute paths are not accepted. Use a workspace-relative path instead (e.g., "files/2026/04/file.pdf"). Got: ${relativePath}`,
    );
  }
  if (relativePath.startsWith("~")) {
    throw new Error(
      `Tilde paths are not accepted. Use a workspace-relative path instead (e.g., "files/2026/04/file.pdf"). Got: ${relativePath}`,
    );
  }

  return resolveSafePath(relativePath, ACCOUNTANT24_HOME);
}
