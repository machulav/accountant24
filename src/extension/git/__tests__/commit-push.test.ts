import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAndPush } from "../commit-push";
import { commitAll, gitInit, hasChanges } from "../git";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-commitpush-"));
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

describe("commitAndPush()", () => {
  test("should commit with the provided message", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "file.txt"), "content");

    const result = await commitAndPush("Add file.txt for testing", dir);

    expect(result.status).toBe("committed");
    expect(result.commitMessage).toBe("Add file.txt for testing");
    expect(result.committedFiles).toEqual(["file.txt"]);
    expect(result.pushed).toBe(false);
    expect(await hasChanges(dir)).toBe(false);

    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: dir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("Add file.txt for testing");
  });

  test("should return multiple committed files", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "a.txt"), "a");
    writeFileSync(join(dir, "b.txt"), "b");

    const result = await commitAndPush("Add a and b files", dir);

    expect(result.status).toBe("committed");
    expect(result.committedFiles).toContain("a.txt");
    expect(result.committedFiles).toContain("b.txt");
  });

  test("should return no_changes when there are no changes", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "file.txt"), "content");
    await commitAll(dir, "initial");

    const result = await commitAndPush("Should not commit", dir);

    expect(result.status).toBe("no_changes");
    expect(result.committedFiles).toEqual([]);
    expect(result.commitMessage).toBe("");
    expect(result.pushed).toBe(false);
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
    const result = await commitAndPush("Push test", dir);

    expect(result.status).toBe("committed");
    expect(result.pushed).toBe(true);

    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: bareDir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("Push test");
  });

  test("should return no_changes when only session files changed", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "init.txt"), "init");
    await commitAll(dir, "initial");

    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(join(dir, "sessions", "abc.json"), '{"messages":[]}');

    const result = await commitAndPush("Should not commit sessions only", dir);

    expect(result.status).toBe("no_changes");
    expect(result.committedFiles).toEqual([]);
    expect(result.pushed).toBe(false);
  });

  test("should commit session files along with meaningful changes", async () => {
    const dir = freshDir();
    await initRepo(dir);

    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(join(dir, "sessions", "abc.json"), '{"messages":[]}');
    writeFileSync(join(dir, "memory.md"), "updated memory");

    const result = await commitAndPush("Update memory", dir);

    expect(result.status).toBe("committed");
    expect(result.committedFiles).toEqual(["memory.md"]);
    expect(result.committedFiles).not.toContain("sessions/abc.json");
    expect(await hasChanges(dir)).toBe(false);

    // Both files should be committed
    const proc = Bun.spawn(["git", "show", "--name-only", "--format="], { cwd: dir, stdout: "pipe" });
    const show = await new Response(proc.stdout).text();
    expect(show).toContain("sessions/abc.json");
    expect(show).toContain("memory.md");
  });

  test("should exclude all session files from committedFiles", async () => {
    const dir = freshDir();
    await initRepo(dir);

    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(join(dir, "sessions", "s1.json"), "{}");
    writeFileSync(join(dir, "sessions", "s2.json"), "{}");
    writeFileSync(join(dir, "ledger.txt"), "2025-01-01 * Test");
    writeFileSync(join(dir, "memory.md"), "notes");

    const result = await commitAndPush("Mixed changes", dir);

    expect(result.status).toBe("committed");
    expect(result.committedFiles).toContain("ledger.txt");
    expect(result.committedFiles).toContain("memory.md");
    expect(result.committedFiles.every((f: string) => !f.startsWith("sessions/"))).toBe(true);
    expect(await hasChanges(dir)).toBe(false);
  });

  test("should silently fail when git is not installed", async () => {
    const dir = freshDir();
    Bun.spawn = ((_cmd: string[], _opts?: any) => {
      const err: any = new Error("spawn git ENOENT");
      err.code = "ENOENT";
      throw err;
    }) as unknown as typeof Bun.spawn;

    await expect(commitAndPush("Should not crash", dir)).resolves.toEqual({
      status: "no_changes",
      committedFiles: [],
      commitMessage: "",
      pushed: false,
    });
  });
});
