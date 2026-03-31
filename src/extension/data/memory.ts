import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MEMORY_PATH } from "../config";
import { generateDiff } from "./diff";

export interface SaveMemoryResult {
  diff: string;
}

export async function getMemory(): Promise<string> {
  try {
    return readFileSync(MEMORY_PATH, "utf-8").trim();
  } catch {
    return "";
  }
}

export function saveMemory(content: string): SaveMemoryResult {
  let oldContent: string;
  try {
    oldContent = readFileSync(MEMORY_PATH, "utf-8");
  } catch {
    oldContent = "";
  }

  const newContent = `${content.trim()}\n`;
  mkdirSync(dirname(MEMORY_PATH), { recursive: true });
  writeFileSync(MEMORY_PATH, newContent);

  const diff = generateDiff(oldContent, newContent);
  return { diff };
}
