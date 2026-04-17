import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { FILES_DIR } from "../config";

export function copyFileToWorkspace(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");

  const dir = join(FILES_DIR, year, month);
  mkdirSync(dir, { recursive: true });

  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${year}${month}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const name = `${stamp}_${basename(filePath)}`;
  const storedPath = deduplicatePath(dir, name);
  copyFileSync(filePath, storedPath);

  return storedPath;
}

function deduplicatePath(dir: string, name: string): string {
  const target = join(dir, name);
  if (!existsSync(target)) return target;

  const ext = extname(name);
  const base = ext.length > 0 ? name.slice(0, -ext.length) : name;

  for (let counter = 2; counter <= 1000; counter++) {
    const candidate = join(dir, `${base}-${counter}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Too many files with the same name: ${name}`);
}
