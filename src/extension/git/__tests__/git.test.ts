import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, diffStat, gitInit, hasChanges, hasRemotes, push } from "../git";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-git-"));
const origSpawn = Bun.spawn;

afterAll(() => rmSync(BASE, { recursive: true, force: true }));
afterEach(() => {
  Bun.spawn = origSpawn;
});

// Helper: create a fresh git repo in a temp dir
function freshDir(): string {
  const dir = mkdtempSync(join(BASE, "repo-"));
  return dir;
}

async function initRepo(dir: string): Promise<void> {
  await gitInit(dir);
  // Configure user for commits in this test repo
  const spawn = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" }).exited;
  await spawn(["config", "user.email", "test@test.com"]);
  await spawn(["config", "user.name", "Test"]);
}

// ── gitInit() ───────────────────────────────────────────────────────

describe("gitInit()", () => {
  test("should create a .git directory and return true", async () => {
    const dir = freshDir();
    const result = await gitInit(dir);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(result).toBe(true);
  });

  test("should return false when .git already exists", async () => {
    const dir = freshDir();
    await gitInit(dir);
    const result = await gitInit(dir);
    expect(result).toBe(false);
  });
});

// ── hasChanges() ────────────────────────────────────────────────────

describe("hasChanges()", () => {
  test("should return false in a clean repo", async () => {
    const dir = freshDir();
    await initRepo(dir);
    // Need at least one commit for a clean state
    writeFileSync(join(dir, "init.txt"), "init");
    await commitAll(dir, "initial commit");

    expect(await hasChanges(dir)).toBe(false);
  });

  test("should return true when there are untracked files", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "new-file.txt"), "hello");

    expect(await hasChanges(dir)).toBe(true);
  });

  test("should return true when tracked files are modified", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "file.txt"), "original");
    await commitAll(dir, "add file");

    writeFileSync(join(dir, "file.txt"), "modified");
    expect(await hasChanges(dir)).toBe(true);
  });

  test("should return true in a fresh repo with no commits", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "file.txt"), "content");

    expect(await hasChanges(dir)).toBe(true);
  });
});

// ── hasRemotes() ────────────────────────────────────────────────────

describe("hasRemotes()", () => {
  test("should return false when no remotes configured", async () => {
    const dir = freshDir();
    await initRepo(dir);

    expect(await hasRemotes(dir)).toBe(false);
  });

  test("should return true when a remote is configured", async () => {
    const dir = freshDir();
    await initRepo(dir);
    await Bun.spawn(["git", "remote", "add", "origin", "https://example.com/repo.git"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    expect(await hasRemotes(dir)).toBe(true);
  });
});

// ── commitAll() ─────────────────────────────────────────────────────

describe("commitAll()", () => {
  test("should commit all changes with the given message", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "file.txt"), "content");

    await commitAll(dir, "test commit message");

    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: dir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("test commit message");
  });

  test("should include untracked files", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "tracked.txt"), "tracked");
    await commitAll(dir, "initial");

    writeFileSync(join(dir, "untracked.txt"), "new file");
    await commitAll(dir, "add untracked");

    expect(await hasChanges(dir)).toBe(false);
    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: dir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("add untracked");
  });

  test("should include deleted files", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "to-delete.txt"), "content");
    await commitAll(dir, "initial");

    rmSync(join(dir, "to-delete.txt"));
    await commitAll(dir, "delete file");

    expect(await hasChanges(dir)).toBe(false);
  });

  test("should include files in subdirectories", async () => {
    const dir = freshDir();
    await initRepo(dir);
    mkdirSync(join(dir, "ledger"), { recursive: true });
    writeFileSync(join(dir, "ledger", "2025.txt"), "transaction data");

    await commitAll(dir, "add journal");

    expect(await hasChanges(dir)).toBe(false);
  });
});

// ── diffStat() ──────────────────────────────────────────────────────

describe("diffStat()", () => {
  test("should return list of changed file paths", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "a.txt"), "a");
    writeFileSync(join(dir, "b.txt"), "b");

    const files = await diffStat(dir);
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
    expect(files).toHaveLength(2);
  });

  test("should return empty array when no changes", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "file.txt"), "content");
    await commitAll(dir, "initial");

    const files = await diffStat(dir);
    expect(files).toEqual([]);
  });

  test("should include files in subdirectories with relative paths", async () => {
    const dir = freshDir();
    await initRepo(dir);
    mkdirSync(join(dir, "ledger"), { recursive: true });
    writeFileSync(join(dir, "ledger", "2025.txt"), "data");

    const files = await diffStat(dir);
    expect(files).toContain("ledger/2025.txt");
  });

  test("should include modified files", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "file.txt"), "original");
    await commitAll(dir, "initial");

    writeFileSync(join(dir, "file.txt"), "modified");
    const files = await diffStat(dir);
    expect(files).toEqual(["file.txt"]);
  });

  test("should include deleted files", async () => {
    const dir = freshDir();
    await initRepo(dir);
    writeFileSync(join(dir, "file.txt"), "content");
    await commitAll(dir, "initial");

    rmSync(join(dir, "file.txt"));
    const files = await diffStat(dir);
    expect(files).toEqual(["file.txt"]);
  });
});

// ── push() ──────────────────────────────────────────────────────────

describe("push()", () => {
  test("should push to a local bare remote", async () => {
    // Set up a bare repo as remote
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
    await commitAll(dir, "initial commit");
    await push(dir);

    // Verify the bare repo received the commit
    const proc = Bun.spawn(["git", "log", "--oneline", "-1"], { cwd: bareDir, stdout: "pipe" });
    const log = await new Response(proc.stdout).text();
    expect(log).toContain("initial commit");
  });
});

// ── git not installed ───────────────────────────────────────────────

describe("when git is not installed", () => {
  function simulateGitMissing(): void {
    Bun.spawn = ((_cmd: string[], _opts?: any) => {
      const err: any = new Error("spawn git ENOENT");
      err.code = "ENOENT";
      throw err;
    }) as unknown as typeof Bun.spawn;
  }

  test("gitInit() should silently fail", async () => {
    const dir = freshDir();
    simulateGitMissing();
    await expect(gitInit(dir)).resolves.toBe(true);
  });

  test("hasChanges() should return false", async () => {
    const dir = freshDir();
    simulateGitMissing();
    expect(await hasChanges(dir)).toBe(false);
  });

  test("hasRemotes() should return false", async () => {
    const dir = freshDir();
    simulateGitMissing();
    expect(await hasRemotes(dir)).toBe(false);
  });

  test("commitAll() should silently fail", async () => {
    const dir = freshDir();
    simulateGitMissing();
    await expect(commitAll(dir, "test")).resolves.toBeUndefined();
  });

  test("push() should silently fail", async () => {
    const dir = freshDir();
    simulateGitMissing();
    await expect(push(dir)).resolves.toBeUndefined();
  });

  test("diffStat() should return empty array", async () => {
    const dir = freshDir();
    simulateGitMissing();
    expect(await diffStat(dir)).toEqual([]);
  });
});

// ── non-ENOENT spawn errors ─────────────────────────────────────────

describe("when spawn throws a non-ENOENT error", () => {
  test("should re-throw the error", async () => {
    const dir = freshDir();
    Bun.spawn = (() => {
      throw new Error("unexpected failure");
    }) as unknown as typeof Bun.spawn;

    await expect(hasChanges(dir)).rejects.toThrow("unexpected failure");
  });
});
