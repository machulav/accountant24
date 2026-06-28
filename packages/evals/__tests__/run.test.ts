import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const runScript = join(import.meta.dirname, "../run.ts");
const textHook = join(import.meta.dirname, "../../../scripts/text-import-register.mjs");

describe("run.ts", () => {
  it("should exit 0 when no cases match filter (empty results)", () => {
    const result = spawnSync("node", ["--import", "tsx", "--import", textHook, runScript], {
      env: { ...process.env, EVAL_FILTER: "nonexistent-filter-xyz-999" },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  }, 30_000);
});
