// 0003 over a REAL temp workspace: `uv/` joins the workspace's .gitignore
// exactly once, whatever the file looked like before, and a workspace that has
// no .gitignore yet is left to the scaffold.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ignoreUvDir } from "../0003-ignore-uv-dir";
import { MIGRATIONS_STATE_FILE, runMigrations } from "../runner";

let home: string;
const workspace = () => path.join(home, ".accountant24");
const gitignore = () => path.join(workspace(), ".gitignore");
const ctx = () => ({ workspaceDir: workspace(), homeDir: home });
const run = () => ignoreUvDir.run(ctx());

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "a24-home-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function seed(content: string): void {
  writeFileSync(gitignore(), content);
}

describe("0003-ignore-uv-dir", () => {
  beforeEach(() => {
    mkdirSync(workspace(), { recursive: true });
  });

  it("should carry the id the runner records", () => {
    expect(ignoreUvDir.id).toBe("0003-ignore-uv-dir");
  });

  it("should append uv/ to a .gitignore from the 0.3 scaffold", async () => {
    seed("auth.json\nsessions/\n");
    await run();
    expect(readFileSync(gitignore(), "utf8")).toBe("auth.json\nsessions/\nuv/\n");
  });

  it("should start a new line first when the file does not end with one", async () => {
    seed("auth.json\nsessions/");
    await run();
    expect(readFileSync(gitignore(), "utf8")).toBe("auth.json\nsessions/\nuv/\n");
  });

  it("should add the line to an empty .gitignore", async () => {
    seed("");
    await run();
    expect(readFileSync(gitignore(), "utf8")).toBe("uv/\n");
  });

  it("should leave a .gitignore that already lists uv/ byte-identical", async () => {
    seed("auth.json\nuv/\nsessions/\n");
    await run();
    expect(readFileSync(gitignore(), "utf8")).toBe("auth.json\nuv/\nsessions/\n");
  });

  it("should recognise the line with surrounding spaces or Windows line endings", async () => {
    seed("auth.json\r\n  uv/  \r\nsessions/\r\n");
    await run();
    expect(readFileSync(gitignore(), "utf8")).toBe("auth.json\r\n  uv/  \r\nsessions/\r\n");
  });

  it("should not mistake a longer path for the line", async () => {
    seed("auth.json\nuv/python/\n");
    await run();
    expect(readFileSync(gitignore(), "utf8")).toBe("auth.json\nuv/python/\nuv/\n");
  });

  it("should add the line only once when run twice", async () => {
    seed("auth.json\n");
    await run();
    await run();
    expect(readFileSync(gitignore(), "utf8")).toBe("auth.json\nuv/\n");
  });

  it("should create nothing when the workspace has no .gitignore", async () => {
    await run();
    expect(existsSync(gitignore())).toBe(false);
  });

  it("should do nothing when the workspace folder does not exist yet", async () => {
    rmSync(workspace(), { recursive: true, force: true });
    await run();
    expect(existsSync(workspace())).toBe(false);
  });

  it("should be recorded by the runner after it ran", async () => {
    seed("auth.json\n");
    const applied = await runMigrations([ignoreUvDir], ctx());
    expect(applied).toEqual(["0003-ignore-uv-dir"]);
    expect(JSON.parse(readFileSync(path.join(workspace(), MIGRATIONS_STATE_FILE), "utf8"))).toEqual({
      applied: ["0003-ignore-uv-dir"],
    });
    expect(readFileSync(gitignore(), "utf8")).toBe("auth.json\nuv/\n");
  });
});
