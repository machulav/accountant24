import { readFileSync } from "node:fs";
import { MEMORY_PATH } from "../config";

export async function getMemory(): Promise<string> {
  try {
    return readFileSync(MEMORY_PATH, "utf-8").trim();
  } catch {
    return "";
  }
}
