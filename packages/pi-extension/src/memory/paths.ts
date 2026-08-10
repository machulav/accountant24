import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_PATH } from "../config";

// pi's built-in file tools normalize their `path` argument before resolving it
// against the agent cwd (unicode spaces to ASCII, one leading "@" stripped,
// "~" expanded, file:// URLs converted). pi does not export those helpers, so
// the same normalization is replicated here to decide whether a tool call
// targets the memory file.
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

export function isMemoryFilePath(rawPath: unknown, cwd: string): boolean {
  if (typeof rawPath !== "string" || rawPath.length === 0) return false;
  try {
    let path = rawPath.replace(UNICODE_SPACES, " ");
    if (path.startsWith("@")) path = path.slice(1);
    if (path === "~") path = homedir();
    else if (path.startsWith("~/")) path = join(homedir(), path.slice(2));
    if (/^file:\/\//.test(path)) path = fileURLToPath(path);
    const resolved = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
    return resolved === MEMORY_PATH;
  } catch {
    return false;
  }
}
