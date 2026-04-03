import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoCommitAndPush } from "../auto-commit";
import { commitAll, gitInit, hasChanges } from "../git";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-autocommit-"));
const origSpawn = Bun.spawn;

afterAll(() => rmSync(BASE, { recursive: true, force: true }));
afterEach(() => {
  Bun.spawn = origSpawn;
});

function freshDir(): string {
  return mkdtempSync(join(BASE, "repo-"));
}

async function initRepo(dir: string): Promise<void> {
  await gitInit(dir);
  const spawn = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" }).exited;
  await spawn(["config", "user.email", "test@test.com"]);
  await spawn(["config", "user.name", "Test"]);
}

describe("autoCommitAndPush()", () => {
  test("should commit changes with diff-based message", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "file.txt"), "content");

    await autoCommitAndPush(dir);

    expect(await hasChanges(dir)).toBe(false);
    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: dir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("Update file.txt");
  });

  test("should include multiple file names in message", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "a.txt"), "a");
    writeFileSync(join(dir, "b.txt"), "b");

    await autoCommitAndPush(dir);

    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: dir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("a.txt");
    expect(log).toContain("b.txt");
  });

  test("should do nothing when there are no changes", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "file.txt"), "content");
    await commitAll(dir, "initial");

    await autoCommitAndPush(dir);

    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: dir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("initial");
  });

  test("should push when remotes are configured", async () => {
    const bareDir = freshDir();
    await Bun.spawn(["git", "init", "--bare"], { cwd: bareDir, stdout: "pipe", stderr: "pipe" }).exited;

    const dir = freshDir();
    await initRepo(dir);
    await Bun.spawn(["git", "remote", "add", "origin", bareDir], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    writeFileSync(join(dir, "file.txt"), "content");
    await autoCommitAndPush(dir);

    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: bareDir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("Update file.txt");
  });

  test("should not commit when only session files changed", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "init.txt"), "init");
    await commitAll(dir, "initial");

    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(join(dir, "sessions", "abc.json"), '{"messages":[]}');

    await autoCommitAndPush(dir);

    // Should still have uncommitted session changes
    const proc = Bun.spawn(["git", "log", "--oneline"], { cwd: dir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    const lines = log.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("initial");
  });

  test("should commit session files along with meaningful changes", async () => {
    const dir = freshDir();
    await initRepo(dir);

    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(join(dir, "sessions", "abc.json"), '{"messages":[]}');
    writeFileSync(join(dir, "memory.md"), "updated memory");

    await autoCommitAndPush(dir);

    expect(await hasChanges(dir)).toBe(false);
    // Both files should be committed
    const proc = Bun.spawn(["git", "show", "--name-only", "--format="], { cwd: dir, stdout: "pipe" });
    const show = await new Response(proc.stdout).text();
    expect(show).toContain("sessions/abc.json");
    expect(show).toContain("memory.md");
  });

  test("should not include session files in commit message", async () => {
    const dir = freshDir();
    await initRepo(dir);

    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(join(dir, "sessions", "abc.json"), '{"messages":[]}');
    writeFileSync(join(dir, "ledger.journal"), "2025-03-30 Groceries");

    await autoCommitAndPush(dir);

    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: dir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("ledger.journal");
    expect(log).not.toContain("sessions");
  });

  test("should silently fail when git is not installed", async () => {
    const dir = freshDir();
    Bun.spawn = ((_cmd: string[], _opts?: any) => {
      const err: any = new Error("spawn git ENOENT");
      err.code = "ENOENT";
      throw err;
    }) as unknown as typeof Bun.spawn;

    await expect(autoCommitAndPush(dir)).resolves.toBeUndefined();
  });
});
