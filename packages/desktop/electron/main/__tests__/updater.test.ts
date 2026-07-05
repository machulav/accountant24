import { describe, expect, it, vi } from "vitest";

// updater.ts is Electron/network glue around electron-updater; the only real
// logic is the shouldAutoUpdate gate (dev and rc builds must never self-update).
// Electron and electron-updater are the faked I/O boundaries so the module can
// be imported outside a packaged app.
vi.mock("electron", () => ({
  app: { isPackaged: false, getVersion: () => "0.0.0" },
}));
vi.mock("electron-updater", () => ({
  default: { autoUpdater: { on: vi.fn() } },
}));

import { shouldAutoUpdate } from "../updater";

describe("shouldAutoUpdate()", () => {
  it("should return false when the app is not packaged (dev run)", () => {
    expect(shouldAutoUpdate(false, "0.3.0")).toBe(false);
  });

  it("should return false when the version is a prerelease (rc build)", () => {
    expect(shouldAutoUpdate(true, "0.3.0-rc.1")).toBe(false);
  });

  it("should return false when not packaged and prerelease", () => {
    expect(shouldAutoUpdate(false, "0.3.0-rc.1")).toBe(false);
  });

  it("should return true when packaged with a stable version", () => {
    expect(shouldAutoUpdate(true, "0.3.0")).toBe(true);
  });
});
