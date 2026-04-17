import { normalize, resolve, sep } from "node:path";

export function resolveSafePath(userPath: string, baseDir: string): string {
  const resolved = normalize(resolve(baseDir, userPath));
  if (resolved !== baseDir && !resolved.startsWith(baseDir + sep)) {
    throw new Error(`Path escapes base directory: ${userPath}`);
  }
  return resolved;
}
