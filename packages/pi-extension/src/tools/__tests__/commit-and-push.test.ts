import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-commit-tool-"));

vi.mock("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

const { commitAndPushTool } = await import("../commit-and-push.js");

async function gitRun(args: string[], cwd = BASE) {
  return spawnText(["git", ...args], { cwd });
}

afterAll(() => rmSync(BASE, { recursive: true, force: true }));

beforeEach(async () => {
  // Reset repo to a clean state
  await gitRun(["checkout", "--orphan", "tmp"]).catch(() => {});
  await gitRun(["branch", "-D", "main"]).catch(() => {});
  await gitRun(["checkout", "-b", "main"]).catch(() => {});
  await gitRun(["rm", "-rf", "."]).catch(() => {});
  await gitRun(["remote", "remove", "origin"]).catch(() => {});
  writeFileSync(join(BASE, "init.txt"), "init");
  await gitRun(["add", "-A"]);
  await gitRun(["commit", "-m", "initial"]);
});

await gitRun(["init"]);
await gitRun(["config", "user.email", "test@test.com"]);
await gitRun(["config", "user.name", "Test"]);
writeFileSync(join(BASE, "init.txt"), "init");
await gitRun(["add", "-A"]);
await gitRun(["commit", "-m", "initial"]);

const run = (params: any) =>
  commitAndPushTool.execute("test", params, undefined, undefined, undefined as any) as Promise<any>;

describe("commit_and_push tool", () => {
  test("should return no changes for clean repo", async () => {
    const result = await run({ message: "Nothing to commit" });

    expect(result.content[0].text).toBe("No changes to commit.");
    expect(result.details.status).toBe("no_changes");
  });

  test("should commit with provided message and return details", async () => {
    writeFileSync(join(BASE, "ledger.journal"), "2025-01-01 * Groceries");

    const result = await run({ message: "Add January groceries" });

    expect(result.details.status).toBe("committed");
    expect(result.details.commitMessage).toBe("Add January groceries");
    expect(result.details.committedFiles).toContain("ledger.journal");
    expect(result.details.pushed).toBe(false);
    expect(result.content[0].text).toContain("Add January groceries");
  });

  test("should report pushed=true when remote exists", async () => {
    const bareDir = mkdtempSync(join(tmpdir(), "accountant24-bare-"));
    await spawnText(["git", "init", "--bare"], { cwd: bareDir });
    await gitRun(["remote", "add", "origin", bareDir]);

    writeFileSync(join(BASE, "file.txt"), "content");

    const result = await run({ message: "Push test" });

    expect(result.details.pushed).toBe(true);
    expect(result.content[0].text).toContain("Pushed to remote.");

    rmSync(bareDir, { recursive: true, force: true });
  });

  test("should report no remote when none configured", async () => {
    writeFileSync(join(BASE, "file.txt"), "content");

    const result = await run({ message: "Local only" });

    expect(result.details.pushed).toBe(false);
    expect(result.content[0].text).toContain("No remote configured");
  });
});
