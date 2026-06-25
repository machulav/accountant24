import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const runScript = join(import.meta.dirname, "../run.ts");

describe("run.ts", () => {
  it("should exit 0 when no cases match filter (empty results)", async () => {
    const proc = Bun.spawn(["bun", "run", runScript], {
      env: { ...process.env, EVAL_FILTER: "nonexistent-filter-xyz-999" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });
});
