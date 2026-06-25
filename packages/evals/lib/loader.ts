import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EvalCaseSchema, type LoadedEvalCase } from "./types";

export function loadCases(filter?: string): LoadedEvalCase[] {
  const casesDir = join(import.meta.dirname, "../cases");
  const files = readdirSync(casesDir).filter((f) => f.endsWith(".jsonl"));

  const cases: LoadedEvalCase[] = [];
  for (const file of files) {
    const raw = readFileSync(join(casesDir, file), "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      cases.push({ ...EvalCaseSchema.parse(JSON.parse(line)), sourceFile: file });
    }
  }

  if (filter) {
    return cases.filter((c) => c.id.includes(filter));
  }
  return cases;
}
