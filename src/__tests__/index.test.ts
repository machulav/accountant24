import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager, VERSION } from "@mariozechner/pi-coding-agent";

describe("startup settings overrides", () => {
  function createSettingsManager() {
    const tmp = mkdtempSync(join(tmpdir(), "a24-settings-"));
    const sm = SettingsManager.create(tmp, tmp);
    sm.applyOverrides({
      quietStartup: true,
      collapseChangelog: true,
      lastChangelogVersion: VERSION,
    });
    return sm;
  }

  test("should suppress changelog by setting lastChangelogVersion to current VERSION to not show the changelog on startup", () => {
    const sm = createSettingsManager();
    expect(sm.getLastChangelogVersion()).toBe(VERSION);
  });

  test("should enable quietStartup to not show the welcome message on startup", () => {
    const sm = createSettingsManager();
    expect(sm.getQuietStartup()).toBe(true);
  });

  test("should enable collapseChangelog as fallback to not show the changelog on startup", () => {
    const sm = createSettingsManager();
    expect(sm.getCollapseChangelog()).toBe(true);
  });

  test("VERSION should be a valid semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
