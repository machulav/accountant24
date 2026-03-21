import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type EvalCase, EvalCaseSchema } from "./types.js";

export function loadCases(filter?: string): EvalCase[] {
  const casesDir = join(import.meta.dirname, "../cases");
  const files = readdirSync(casesDir).filter((f) => f.endsWith(".jsonl"));

  const cases: EvalCase[] = [];
  for (const file of files) {
    const raw = readFileSync(join(casesDir, file), "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      cases.push(EvalCaseSchema.parse(JSON.parse(line)));
    }
  }

  if (filter) {
    return cases.filter((c) => c.id.includes(filter));
  }
  return cases;
}
