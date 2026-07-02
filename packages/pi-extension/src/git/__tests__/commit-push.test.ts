import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { spawnText } from "../../spawn";
import { commitAndPush } from "../commit-push";
import { commitAll, gitInit, hasChanges } from "../git";

vi.mock("../../spawn");

const BASE = mkdtempSync(join(tmpdir(), "accountant24-commitpush-"));

// Real git for test setup/verification, independent of the spawnText mock.
function git(args: string[], cwd: string): string {
  return spawnSync("git", args, { cwd, encoding: "utf8" }).stdout ?? "";
}

afterAll(() => rmSync(BASE, { recursive: true, force: true }));

// By default the module under test runs REAL git; the failure test below overrides.
beforeEach(() => {
  vi.mocked(spawnText).mockImplementation(async (cmd, opts) => {
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd: opts?.cwd, encoding: "utf8" });
    if (r.error) throw r.error;
    return { exitCode: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  });
});

function freshDir(): string {
  return mkdtempSync(join(BASE, "repo-"));
}

async function initRepo(dir: string): Promise<void> {
  await gitInit(dir);
  git(["config", "user.email", "test@test.com"], dir);
  git(["config", "user.name", "Test"], dir);
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

    const log = git(["log", "--oneline", "-1"], dir);
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
    git(["init", "--bare"], bareDir);

    const dir = freshDir();
    await initRepo(dir);
    git(["remote", "add", "origin", bareDir], dir);

    writeFileSync(join(dir, "file.txt"), "content");
    const result = await commitAndPush("Push test", dir);

    expect(result.status).toBe("committed");
    expect(result.pushed).toBe(true);

    const log = git(["log", "--oneline", "-1"], bareDir);
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
    const show = git(["show", "--name-only", "--format="], dir);
    expect(show).toContain("sessions/abc.json");
    expect(show).toContain("memory.md");
  });

  test("should exclude all session files from committedFiles", async () => {
    const dir = freshDir();
    await initRepo(dir);

    mkdirSync(join(dir, "sessions"), { recursive: true });
    writeFileSync(join(dir, "sessions", "s1.json"), "{}");
    writeFileSync(join(dir, "sessions", "s2.json"), "{}");
    writeFileSync(join(dir, "ledger.journal"), "2025-01-01 * Test");
    writeFileSync(join(dir, "memory.md"), "notes");

    const result = await commitAndPush("Mixed changes", dir);

    expect(result.status).toBe("committed");
    expect(result.committedFiles).toContain("ledger.journal");
    expect(result.committedFiles).toContain("memory.md");
    expect(result.committedFiles.every((f: string) => !f.startsWith("sessions/"))).toBe(true);
    expect(await hasChanges(dir)).toBe(false);
  });

  test("should silently fail when git is not installed", async () => {
    const dir = freshDir();
    vi.mocked(spawnText).mockImplementation(async () => {
      const err: NodeJS.ErrnoException = new Error("spawn git ENOENT");
      err.code = "ENOENT";
      throw err;
    });

    await expect(commitAndPush("Should not crash", dir)).resolves.toEqual({
      status: "no_changes",
      committedFiles: [],
      commitMessage: "",
      pushed: false,
    });
  });
});
