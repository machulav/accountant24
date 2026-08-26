// 0001 over a REAL temp "home": the old ~/Accountant24 is moved to the new
// hidden default exactly once, and only for the default workspace location.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { relocateLegacyHome } from "../0001-relocate-legacy-home";

let home: string;
const legacy = () => path.join(home, "Accountant24");
const target = () => path.join(home, ".accountant24");

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "a24-home-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function seedLegacy(): void {
  mkdirSync(path.join(legacy(), "ledger", "2026"), { recursive: true });
  mkdirSync(path.join(legacy(), ".git"), { recursive: true });
  writeFileSync(path.join(legacy(), "ledger", "main.journal"), "; main\n");
  writeFileSync(path.join(legacy(), "ledger", "2026", "01.journal"), "2026-01-01 x\n");
  writeFileSync(path.join(legacy(), "app-settings.json"), '{"defaultModel":"a/1"}\n');
  writeFileSync(path.join(legacy(), ".git", "HEAD"), "ref: refs/heads/main\n");
}

describe("0001-relocate-legacy-home", () => {
  it("should carry the id the runner records", () => {
    expect(relocateLegacyHome.id).toBe("0001-relocate-legacy-home");
  });

  it("should move ~/Accountant24 to ~/.accountant24 with everything inside when only the old folder exists", async () => {
    seedLegacy();
    await relocateLegacyHome.run({ workspaceDir: target(), homeDir: home });
    expect(existsSync(legacy())).toBe(false);
    expect(readFileSync(path.join(target(), "ledger", "main.journal"), "utf8")).toBe("; main\n");
    expect(readFileSync(path.join(target(), "ledger", "2026", "01.journal"), "utf8")).toBe("2026-01-01 x\n");
    expect(readFileSync(path.join(target(), "app-settings.json"), "utf8")).toBe('{"defaultModel":"a/1"}\n');
    expect(readFileSync(path.join(target(), ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
  });

  it("should do nothing on a fresh install where neither folder exists", async () => {
    await relocateLegacyHome.run({ workspaceDir: target(), homeDir: home });
    expect(existsSync(legacy())).toBe(false);
    expect(existsSync(target())).toBe(false);
  });

  it("should leave both folders untouched when ~/.accountant24 already exists", async () => {
    seedLegacy();
    mkdirSync(target());
    writeFileSync(path.join(target(), "memory.md"), "new\n");
    await relocateLegacyHome.run({ workspaceDir: target(), homeDir: home });
    expect(existsSync(path.join(legacy(), "ledger", "main.journal"))).toBe(true);
    expect(readFileSync(path.join(target(), "memory.md"), "utf8")).toBe("new\n");
    expect(existsSync(path.join(target(), "ledger"))).toBe(false);
  });

  it("should do nothing when the workspace is a custom folder, even if the old default exists", async () => {
    seedLegacy();
    const custom = path.join(home, "Demo");
    await relocateLegacyHome.run({ workspaceDir: custom, homeDir: home });
    expect(existsSync(path.join(legacy(), "ledger", "main.journal"))).toBe(true);
    expect(existsSync(custom)).toBe(false);
    expect(existsSync(target())).toBe(false);
  });
});
