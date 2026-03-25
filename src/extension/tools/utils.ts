import { normalize, resolve } from "node:path";

export function resolveSafePath(userPath: string, baseDir: string): string {
  const resolved = normalize(resolve(baseDir, userPath));
  if (!resolved.startsWith(baseDir)) {
    throw new Error(`Path escapes base directory: ${userPath}`);
  }
  return resolved;
}
