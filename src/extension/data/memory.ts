import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MEMORY_PATH } from "../config.js";

export async function getMemory(): Promise<string> {
  try {
    return readFileSync(MEMORY_PATH, "utf-8").trim();
  } catch {
    return "";
  }
}

export function saveMemory(content: string): void {
  mkdirSync(dirname(MEMORY_PATH), { recursive: true });
  writeFileSync(MEMORY_PATH, `${content.trim()}\n`);
}
