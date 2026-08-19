// The migration runner over a REAL temp directory: the filesystem is the one
// I/O boundary, and the state file's exact contents are the contract.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIGRATIONS_STATE_FILE,
  type Migration,
  readMigrationState,
  runMigrations,
  writeMigrationState,
} from "../runner";

let root: string;
let ws: string;
const ctx = () => ({ workspaceDir: ws, homeDir: root });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "a24-mig-"));
  ws = path.join(root, ".accountant24");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const readState = () => JSON.parse(readFileSync(path.join(ws, MIGRATIONS_STATE_FILE), "utf8"));
const seedState = (content: string) => {
  mkdirSync(ws, { recursive: true });
  writeFileSync(path.join(ws, MIGRATIONS_STATE_FILE), content);
};
const noop = (id: string): Migration => ({ id, run: vi.fn() });

describe("readMigrationState()", () => {
  it("should read nothing applied when the workspace does not exist", () => {
    expect(readMigrationState(ws)).toEqual({ applied: [] });
    expect(existsSync(ws)).toBe(false);
  });

  it("should read the applied ids back from the state file", () => {
    seedState(JSON.stringify({ applied: ["0001-a", "0002-b"] }));
    expect(readMigrationState(ws)).toEqual({ applied: ["0001-a", "0002-b"] });
  });

  it("should treat a corrupt state file as nothing applied", () => {
    seedState("{not json");
    expect(readMigrationState(ws)).toEqual({ applied: [] });
  });

  it("should treat a state file without an applied array as nothing applied", () => {
    seedState(JSON.stringify({ applied: "0001-a" }));
    expect(readMigrationState(ws)).toEqual({ applied: [] });
  });

  it("should treat a state file that is valid JSON but not an object as nothing applied", () => {
    seedState("null");
    expect(readMigrationState(ws)).toEqual({ applied: [] });
    seedState('"0001-a"');
    expect(readMigrationState(ws)).toEqual({ applied: [] });
  });

  it("should drop non-string entries from the applied list", () => {
    seedState(JSON.stringify({ applied: ["0001-a", 7, null] }));
    expect(readMigrationState(ws)).toEqual({ applied: ["0001-a"] });
  });
});

describe("writeMigrationState()", () => {
  it("should create the workspace dir and write pretty JSON with a trailing newline", () => {
    writeMigrationState(ws, { applied: ["0001-a"] });
    expect(readFileSync(path.join(ws, MIGRATIONS_STATE_FILE), "utf8")).toBe(
      '{\n  "applied": [\n    "0001-a"\n  ]\n}\n',
    );
  });
});

describe("runMigrations()", () => {
  it("should run every migration in order and record each id when nothing was applied yet", async () => {
    const order: string[] = [];
    const a: Migration = { id: "0001-a", run: () => void order.push("a") };
    const b: Migration = { id: "0002-b", run: () => void order.push("b") };
    await expect(runMigrations([a, b], ctx())).resolves.toEqual(["0001-a", "0002-b"]);
    expect(order).toEqual(["a", "b"]);
    expect(readState()).toEqual({ applied: ["0001-a", "0002-b"] });
  });

  it("should pass the context through to each migration", async () => {
    const m = noop("0001-a");
    await runMigrations([m], ctx());
    expect(m.run).toHaveBeenCalledWith({ workspaceDir: ws, homeDir: root });
  });

  it("should skip migrations already recorded and run only the pending ones", async () => {
    seedState(JSON.stringify({ applied: ["0001-a"] }));
    const a = noop("0001-a");
    const b = noop("0002-b");
    await expect(runMigrations([a, b], ctx())).resolves.toEqual(["0002-b"]);
    expect(a.run).not.toHaveBeenCalled();
    expect(b.run).toHaveBeenCalledTimes(1);
    expect(readState()).toEqual({ applied: ["0001-a", "0002-b"] });
  });

  it("should re-run everything when the state file is corrupt", async () => {
    seedState("{not json");
    const a = noop("0001-a");
    await expect(runMigrations([a], ctx())).resolves.toEqual(["0001-a"]);
    expect(readState()).toEqual({ applied: ["0001-a"] });
  });

  it("should stop at the first failing migration, record only the ones before it, and rethrow with the id", async () => {
    const a = noop("0001-a");
    const boom: Migration = {
      id: "0002-boom",
      run: () => {
        throw new Error("disk full");
      },
    };
    const c = noop("0003-c");
    await expect(runMigrations([a, boom, c], ctx())).rejects.toThrow("migration 0002-boom failed: disk full");
    expect(c.run).not.toHaveBeenCalled();
    expect(readState()).toEqual({ applied: ["0001-a"] });
  });

  it("should wrap a non-Error throw with the migration id too", async () => {
    const weird: Migration = {
      id: "0001-weird",
      run: () => {
        throw "plain string";
      },
    };
    await expect(runMigrations([weird], ctx())).rejects.toThrow("migration 0001-weird failed: plain string");
  });

  it("should keep a failed migration pending so the next launch retries it", async () => {
    let attempts = 0;
    const flaky: Migration = {
      id: "0001-flaky",
      run: () => {
        attempts++;
        if (attempts === 1) throw new Error("first try");
      },
    };
    await expect(runMigrations([flaky], ctx())).rejects.toThrow();
    await expect(runMigrations([flaky], ctx())).resolves.toEqual(["0001-flaky"]);
    expect(attempts).toBe(2);
  });

  it("should await async migrations", async () => {
    let done = false;
    const slow: Migration = {
      id: "0001-slow",
      run: async () => {
        await new Promise((r) => setTimeout(r, 5));
        done = true;
      },
    };
    await runMigrations([slow], ctx());
    expect(done).toBe(true);
    expect(readState()).toEqual({ applied: ["0001-slow"] });
  });

  it("should pick up a state file that a migration moved into place and not re-run what it lists", async () => {
    // Like 0001: the workspace does not exist, the migration renames a folder
    // (that already has a state file) to become the workspace.
    const old = path.join(root, "Old");
    mkdirSync(old);
    writeFileSync(path.join(old, MIGRATIONS_STATE_FILE), JSON.stringify({ applied: ["0002-b"] }));
    const mover: Migration = { id: "0001-move", run: () => renameSync(old, ws) };
    const b = noop("0002-b");
    const c = noop("0003-c");
    await expect(runMigrations([mover, b, c], ctx())).resolves.toEqual(["0001-move", "0003-c"]);
    expect(b.run).not.toHaveBeenCalled();
    expect(readState()).toEqual({ applied: ["0002-b", "0001-move", "0003-c"] });
  });

  it("should not duplicate an id that a migration itself recorded", async () => {
    const self: Migration = {
      id: "0001-self",
      run: ({ workspaceDir }) => writeMigrationState(workspaceDir, { applied: ["0001-self"] }),
    };
    await runMigrations([self], ctx());
    expect(readState()).toEqual({ applied: ["0001-self"] });
  });

  it("should create the workspace dir when recording into one that does not exist yet", async () => {
    await runMigrations([noop("0001-a")], ctx());
    expect(existsSync(ws)).toBe(true);
  });

  it("should write nothing when there is nothing to run", async () => {
    await expect(runMigrations([], ctx())).resolves.toEqual([]);
    expect(existsSync(ws)).toBe(false);
  });

  it("should write nothing when every migration is already recorded", async () => {
    seedState(JSON.stringify({ applied: ["0001-a"] }));
    const before = readFileSync(path.join(ws, MIGRATIONS_STATE_FILE), "utf8");
    await expect(runMigrations([noop("0001-a")], ctx())).resolves.toEqual([]);
    expect(readFileSync(path.join(ws, MIGRATIONS_STATE_FILE), "utf8")).toBe(before);
  });

  it("should refuse a list with duplicate ids before running anything", async () => {
    const a = noop("0001-a");
    const dup = noop("0001-a");
    await expect(runMigrations([a, dup], ctx())).rejects.toThrow("duplicate migration id: 0001-a");
    expect(a.run).not.toHaveBeenCalled();
    expect(existsSync(ws)).toBe(false);
  });
});
