// 0002 over a REAL temp "home": ~/Accountant24 is moved into place even when
// ~/.accountant24 already exists, as long as that folder holds nothing the
// user made; it is set aside as ~/.accountant24.bak first, never deleted. A
// folder with a chat, a ledger edit, a memory or a document of its own keeps
// both folders where they are.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relocateLegacyHome } from "../0001-relocate-legacy-home";
import { relocateLegacyHomeOverUnused } from "../0002-relocate-legacy-home-over-unused";
import { MIGRATIONS_STATE_FILE, runMigrations } from "../runner";

/** The ledger files exactly as the v0.3.0 scaffold wrote them. */
const SCAFFOLD_LEDGER = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "scaffold-0.3.0", "ledger");

let home: string;
const legacy = () => path.join(home, "Accountant24");
const target = () => path.join(home, ".accountant24");
const backup = () => path.join(home, ".accountant24.bak");
const ctx = () => ({ workspaceDir: target(), homeDir: home });
const run = () => relocateLegacyHomeOverUnused.run(ctx());

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "a24-home-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A pi session file: the header line plus one exchange. */
function writeSession(file: string, cwd: string): void {
  write(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "2026-06-01T10:00:00.000Z", cwd })}\n` +
      `${JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "hi" } })}\n`,
  );
}

/** The pre-0.3 workspace: real books, chats, memory, logins, git history. */
function seedLegacy(): void {
  write(path.join(legacy(), "ledger", "main.journal"), "; main\ninclude 2026/01.journal\n");
  write(path.join(legacy(), "ledger", "2026", "01.journal"), "2026-01-01 x\n");
  write(path.join(legacy(), "memory.md"), "# Memory\n");
  write(path.join(legacy(), "auth.json"), '{"anthropic":{"type":"api_key","key":"k"}}\n');
  write(path.join(legacy(), "app-settings.json"), '{"defaultModel":"a/1"}\n');
  write(path.join(legacy(), ".git", "HEAD"), "ref: refs/heads/main\n");
  writeSession(path.join(legacy(), "sessions", "2026-06-01T10-00-00-000Z_old.jsonl"), legacy());
}

/** What v0.1.x pi left in ~/.accountant24: its config dir, no ledger. */
function seedStale(): void {
  write(path.join(target(), "agent", "bin", "fd"), "binary\n");
  writeSession(
    path.join(target(), "agent", "sessions", "--Users-x-repo--", "2026-05-01T10-00-00-000Z_s.jsonl"),
    "/Users/x/repo",
  );
  write(path.join(target(), "agent", "auth.json"), "{}");
  write(path.join(target(), "auth.json"), "{}");
  mkdirSync(path.join(target(), "sessions"), { recursive: true });
}

/** What a 0.3.0 launch scaffolded into ~/.accountant24 (0001 recorded). */
function seedScaffold(): void {
  cpSync(SCAFFOLD_LEDGER, path.join(target(), "ledger"), { recursive: true });
  write(path.join(target(), "memory.md"), "");
  write(path.join(target(), ".gitignore"), "auth.json\nsessions/\n");
  write(path.join(target(), ".git", "HEAD"), "ref: refs/heads/main\n");
  write(path.join(target(), MIGRATIONS_STATE_FILE), '{\n  "applied": [\n    "0001-relocate-legacy-home"\n  ]\n}\n');
  write(path.join(target(), "app-settings.json"), '{"onceEvents":["app_installed"]}\n');
  write(path.join(target(), "plugins", "accountant24-skills", "plugin.json"), '{"name":"accountant24-skills"}\n');
  mkdirSync(path.join(target(), "files"), { recursive: true });
  mkdirSync(path.join(target(), "sessions"), { recursive: true });
}

function expectLegacyInPlace(): void {
  expect(existsSync(legacy())).toBe(false);
  expect(readFileSync(path.join(target(), "ledger", "2026", "01.journal"), "utf8")).toBe("2026-01-01 x\n");
  expect(readFileSync(path.join(target(), "memory.md"), "utf8")).toBe("# Memory\n");
  expect(readFileSync(path.join(target(), ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
  expect(existsSync(path.join(target(), "sessions", "2026-06-01T10-00-00-000Z_old.jsonl"))).toBe(true);
}

function expectNothingMoved(): void {
  expect(readFileSync(path.join(legacy(), "ledger", "2026", "01.journal"), "utf8")).toBe("2026-01-01 x\n");
  expect(existsSync(backup())).toBe(false);
  expect(existsSync(path.join(target(), "ledger", "2026", "01.journal"))).toBe(false);
}

describe("0002-relocate-legacy-home-over-unused", () => {
  it("should carry the id the runner records", () => {
    expect(relocateLegacyHomeOverUnused.id).toBe("0002-relocate-legacy-home-over-unused");
  });

  describe("no legacy workspace to move", () => {
    it("should create nothing on a fresh install where neither folder exists", async () => {
      await run();
      expect(readdirSync(home)).toEqual([]);
    });

    it("should leave a ~/Accountant24 without a ledger alone, and not set the workspace aside for it", async () => {
      write(path.join(legacy(), "notes.txt"), "not a workspace\n");
      seedScaffold();
      await run();
      expect(existsSync(path.join(legacy(), "notes.txt"))).toBe(true);
      expect(existsSync(backup())).toBe(false);
      expect(existsSync(path.join(target(), "ledger", "main.journal"))).toBe(true);
    });

    it("should do nothing for a custom workspace, even with both default folders present", async () => {
      seedLegacy();
      seedStale();
      const custom = path.join(home, "Demo");
      await relocateLegacyHomeOverUnused.run({ workspaceDir: custom, homeDir: home });
      expectNothingMoved();
      expect(existsSync(custom)).toBe(false);
    });
  });

  describe("moving ~/Accountant24 into place", () => {
    it("should move it when ~/.accountant24 does not exist", async () => {
      seedLegacy();
      await run();
      expectLegacyInPlace();
      expect(existsSync(backup())).toBe(false);
    });

    it("should set aside a v0.1.x pi config dir as ~/.accountant24.bak and move the legacy workspace in", async () => {
      seedLegacy();
      seedStale();
      await run();
      expectLegacyInPlace();
      expect(readFileSync(path.join(backup(), "agent", "bin", "fd"), "utf8")).toBe("binary\n");
      expect(readFileSync(path.join(backup(), "auth.json"), "utf8")).toBe("{}");
      expect(readFileSync(path.join(target(), "auth.json"), "utf8")).toBe(
        '{"anthropic":{"type":"api_key","key":"k"}}\n',
      );
    });

    it("should set aside an untouched 0.3.0 scaffold, plugins and 0001 record included", async () => {
      seedLegacy();
      seedScaffold();
      await run();
      expectLegacyInPlace();
      expect(readFileSync(path.join(backup(), "ledger", "accounts.journal"))).toEqual(
        readFileSync(path.join(SCAFFOLD_LEDGER, "accounts.journal")),
      );
      expect(existsSync(path.join(backup(), "plugins", "accountant24-skills", "plugin.json"))).toBe(true);
      expect(JSON.parse(readFileSync(path.join(backup(), MIGRATIONS_STATE_FILE), "utf8"))).toEqual({
        applied: ["0001-relocate-legacy-home"],
      });
      expect(existsSync(path.join(target(), MIGRATIONS_STATE_FILE))).toBe(false);
    });

    it("should set aside the reported case: v0.1.x leftovers with a 0.3.0 scaffold on top", async () => {
      seedLegacy();
      seedStale();
      seedScaffold();
      await run();
      expectLegacyInPlace();
      expect(existsSync(path.join(backup(), "agent", "bin", "fd"))).toBe(true);
      expect(existsSync(path.join(backup(), "ledger", "main.journal"))).toBe(true);
    });

    it("should ignore a session recorded under another folder, as the app does", async () => {
      seedLegacy();
      seedScaffold();
      writeSession(path.join(target(), "sessions", "2026-04-20T10-00-00-000Z_tui.jsonl"), "/Users/x/Accountant24");
      await run();
      expectLegacyInPlace();
      expect(existsSync(path.join(backup(), "sessions", "2026-04-20T10-00-00-000Z_tui.jsonl"))).toBe(true);
    });

    it("should ignore files in sessions/ that are not session files", async () => {
      seedLegacy();
      seedScaffold();
      write(path.join(target(), "sessions", ".DS_Store"), "junk");
      await run();
      expectLegacyInPlace();
    });

    it("should accept a ledger holding only some of the template files", async () => {
      seedLegacy();
      seedScaffold();
      rmSync(path.join(target(), "ledger", "commodities.journal"));
      await run();
      expectLegacyInPlace();
    });

    it("should accept empty subfolders under files/", async () => {
      seedLegacy();
      seedScaffold();
      mkdirSync(path.join(target(), "files", "2026", "08"), { recursive: true });
      await run();
      expectLegacyInPlace();
    });

    it("should finish a run that crashed between the two renames", async () => {
      // The previous run set the scaffold aside and died before moving the
      // legacy folder: the backup exists, ~/.accountant24 does not.
      seedLegacy();
      write(path.join(backup(), "ledger", "main.journal"), "; scaffold\n");
      await run();
      expectLegacyInPlace();
      expect(readFileSync(path.join(backup(), "ledger", "main.journal"), "utf8")).toBe("; scaffold\n");
    });

    it("should do nothing on a second run", async () => {
      seedLegacy();
      seedScaffold();
      await run();
      const before = readdirSync(home).sort();
      await run();
      expect(readdirSync(home).sort()).toEqual(before);
      expectLegacyInPlace();
    });
  });

  describe("~/.accountant24 in use", () => {
    const seedUsed = () => {
      seedLegacy();
      seedScaffold();
    };

    function expectLeftAlone(): void {
      expectNothingMoved();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(target()));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(legacy()));
    }

    it("should leave both folders and warn when a chat was recorded in it", async () => {
      seedUsed();
      writeSession(path.join(target(), "sessions", "2026-08-27T10-00-00-000Z_new.jsonl"), target());
      await run();
      expectLeftAlone();
      expect(existsSync(path.join(target(), "sessions", "2026-08-27T10-00-00-000Z_new.jsonl"))).toBe(true);
    });

    it("should count a session whose cwd resolves to the workspace through a trailing slash", async () => {
      seedUsed();
      writeSession(path.join(target(), "sessions", "s.jsonl"), `${target()}/`);
      await run();
      expectLeftAlone();
    });

    it("should count a session file with an unreadable header as a chat", async () => {
      seedUsed();
      write(path.join(target(), "sessions", "s.jsonl"), "not json\n");
      await run();
      expectLeftAlone();
    });

    it("should count a session file whose header has no cwd as a chat", async () => {
      seedUsed();
      write(path.join(target(), "sessions", "s.jsonl"), '{"type":"session"}\n');
      await run();
      expectLeftAlone();
    });

    it("should count an empty session file as a chat", async () => {
      seedUsed();
      write(path.join(target(), "sessions", "s.jsonl"), "");
      await run();
      expectLeftAlone();
    });

    it("should count a non-empty memory", async () => {
      seedUsed();
      write(path.join(target(), "memory.md"), "Prefers EUR.\n");
      await run();
      expectLeftAlone();
    });

    it("should count a memory.md that is not a file", async () => {
      seedUsed();
      rmSync(path.join(target(), "memory.md"));
      mkdirSync(path.join(target(), "memory.md"));
      await run();
      expectLeftAlone();
    });

    it("should count a stored document", async () => {
      seedUsed();
      write(path.join(target(), "files", "2026", "receipt.pdf"), "%PDF");
      await run();
      expectLeftAlone();
    });

    it("should count a files entry that is not a folder", async () => {
      seedUsed();
      rmSync(path.join(target(), "files"), { recursive: true });
      write(path.join(target(), "files"), "");
      await run();
      expectLeftAlone();
    });

    it("should count an edited template journal", async () => {
      seedUsed();
      write(path.join(target(), "ledger", "accounts.journal"), "account Assets:Bank\n");
      await run();
      expectLeftAlone();
    });

    it("should count an extra entry in ledger/", async () => {
      seedUsed();
      write(path.join(target(), "ledger", "2026", "08.journal"), "2026-08-01 x\n");
      await run();
      expectLeftAlone();
    });

    it("should count a ledger that is not a folder", async () => {
      seedUsed();
      rmSync(path.join(target(), "ledger"), { recursive: true });
      write(path.join(target(), "ledger"), "");
      await run();
      expectLeftAlone();
    });
  });

  describe("unexpected state", () => {
    it("should refuse to move anything when ~/.accountant24.bak already exists", async () => {
      seedLegacy();
      seedStale();
      write(path.join(backup(), "keep.txt"), "mine\n");
      await expect(async () => run()).rejects.toThrow(`${backup()} already exists`);
      expect(readFileSync(path.join(legacy(), "ledger", "2026", "01.journal"), "utf8")).toBe("2026-01-01 x\n");
      expect(readFileSync(path.join(target(), "auth.json"), "utf8")).toBe("{}");
      expect(readFileSync(path.join(backup(), "keep.txt"), "utf8")).toBe("mine\n");
    });

    it("should refuse when ~/.accountant24 is a file", async () => {
      seedLegacy();
      write(target(), "");
      await expect(async () => run()).rejects.toThrow(`${target()} exists but is not a folder`);
      expectNothingMoved();
    });
  });

  describe("through the runner, after 0001 was recorded in the scaffold", () => {
    const migrations = [relocateLegacyHome, relocateLegacyHomeOverUnused];
    const readState = () => JSON.parse(readFileSync(path.join(target(), MIGRATIONS_STATE_FILE), "utf8"));

    it("should skip 0001, move the legacy workspace in, and record 0002 in it", async () => {
      seedLegacy();
      seedStale();
      seedScaffold();
      await expect(runMigrations(migrations, ctx())).resolves.toEqual(["0002-relocate-legacy-home-over-unused"]);
      expectLegacyInPlace();
      expect(readState()).toEqual({ applied: ["0002-relocate-legacy-home-over-unused"] });
    });

    it("should record 0001 as a no-op on the next launch and touch nothing else", async () => {
      seedLegacy();
      seedScaffold();
      await runMigrations(migrations, ctx());
      await expect(runMigrations(migrations, ctx())).resolves.toEqual(["0001-relocate-legacy-home"]);
      expectLegacyInPlace();
      expect(readState()).toEqual({
        applied: ["0002-relocate-legacy-home-over-unused", "0001-relocate-legacy-home"],
      });
      expect(existsSync(path.join(backup(), "ledger", "main.journal"))).toBe(true);
    });
  });
});
