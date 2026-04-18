import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-commit-tool-"));

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

const { commitAndPushTool } = await import("../commit-and-push.js");

async function gitRun(args: string[], cwd = BASE) {
  return Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" }).exited;
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
    writeFileSync(join(BASE, "ledger.txt"), "2025-01-01 * Groceries");

    const result = await run({ message: "Add January groceries" });

    expect(result.details.status).toBe("committed");
    expect(result.details.commitMessage).toBe("Add January groceries");
    expect(result.details.committedFiles).toContain("ledger.txt");
    expect(result.details.pushed).toBe(false);
    expect(result.content[0].text).toContain("Add January groceries");
  });

  test("should report pushed=true when remote exists", async () => {
    const bareDir = mkdtempSync(join(tmpdir(), "accountant24-bare-"));
    await Bun.spawn(["git", "init", "--bare"], { cwd: bareDir, stdout: "pipe", stderr: "pipe" }).exited;
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

describe("commit_and_push renderResult", () => {
  const mockTheme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any;

  // biome-ignore lint/style/noNonNullAssertion: renderResult is always defined on this tool
  const renderFn = commitAndPushTool.renderResult!;
  const render = (details: any) =>
    renderFn({ content: [], details }, { isPartial: false, expanded: true }, mockTheme, { isError: false } as any)
      .render(120)
      .join("\n");

  test("should show 'No changes to commit.' for no_changes status", () => {
    const output = render({ status: "no_changes", committedFiles: [], commitMessage: "", pushed: false });
    expect(output).toContain("No changes to commit.");
  });

  test("should show commit message and files for committed status", () => {
    const output = render({
      status: "committed",
      committedFiles: ["ledger.txt", "memory.md"],
      commitMessage: "Add groceries",
      pushed: false,
    });
    expect(output).toContain("Message");
    expect(output).toContain("Add groceries");
    expect(output).toContain("Files");
    expect(output).toContain("ledger.txt");
    expect(output).toContain("memory.md");
    expect(output).not.toContain("Remote");
  });

  test("should show remote section when pushed", () => {
    const output = render({
      status: "committed",
      committedFiles: ["file.txt"],
      commitMessage: "Update",
      pushed: true,
    });
    expect(output).toContain("Remote");
    expect(output).toContain("Pushed to remote.");
  });
});
