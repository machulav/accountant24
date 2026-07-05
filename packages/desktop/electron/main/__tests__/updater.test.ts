import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// updater.ts wires electron-updater into the silent-update flow: the
// shouldAutoUpdate gate (dev and rc builds must never self-update) plus the
// analytics classification (downloaded / check-error / download-error, deduped
// per session). Electron, electron-updater, and the analytics module (network)
// are the faked I/O boundaries.
type Handler = (payload?: unknown) => void;

const h = vi.hoisted(() => ({
  isPackaged: false,
  version: "0.0.0",
  handlers: new Map<string, Handler>(),
  checkForUpdates: vi.fn(() => Promise.resolve()),
  trackUpdateDownloaded: vi.fn(),
  trackUpdateFailed: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return h.isPackaged;
    },
    getVersion: () => h.version,
  },
}));
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: {
      on: (event: string, fn: Handler) => {
        h.handlers.set(event, fn);
      },
      checkForUpdates: h.checkForUpdates,
    },
  },
}));
vi.mock("../analytics", () => ({
  trackUpdateDownloaded: h.trackUpdateDownloaded,
  trackUpdateFailed: h.trackUpdateFailed,
}));

import { initAutoUpdater, shouldAutoUpdate } from "../updater";

const emit = (event: string, payload?: unknown) => h.handlers.get(event)?.(payload);

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

describe("initAutoUpdater()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.handlers.clear();
    h.isPackaged = true;
    h.version = "1.0.0";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should register nothing and never check when running unpackaged", () => {
    h.isPackaged = false;
    initAutoUpdater();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(h.handlers.size).toBe(0);
    expect(h.checkForUpdates).not.toHaveBeenCalled();
  });

  it("should register nothing and never check for a prerelease version", () => {
    h.version = "1.1.0-rc.1";
    initAutoUpdater();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(h.handlers.size).toBe(0);
    expect(h.checkForUpdates).not.toHaveBeenCalled();
  });

  it("should check for updates 30s after launch and again every 4h", () => {
    initAutoUpdater();
    expect(h.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4 * 60 * 60 * 1000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("should survive a rejected check and still check again next cycle", async () => {
    h.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    initAutoUpdater();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("should track update_downloaded with the new version when a download completes", () => {
    initAutoUpdater();
    emit("update-available");
    emit("update-downloaded", { version: "1.1.0" });
    expect(h.trackUpdateDownloaded).toHaveBeenCalledExactlyOnceWith("1.1.0");
    expect(h.trackUpdateFailed).not.toHaveBeenCalled();
  });

  it("should track a check error when no update was being downloaded", () => {
    initAutoUpdater();
    emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(h.trackUpdateFailed).toHaveBeenCalledExactlyOnceWith("check");
  });

  it("should track a download error when the failure happens after update-available", () => {
    initAutoUpdater();
    emit("update-available");
    emit("error", new Error("sha512 checksum mismatch"));
    expect(h.trackUpdateFailed).toHaveBeenCalledExactlyOnceWith("download");
  });

  it("should classify an error after a completed download as a check error", () => {
    initAutoUpdater();
    emit("update-available");
    emit("update-downloaded", { version: "1.1.0" });
    emit("error", new Error("offline"));
    expect(h.trackUpdateFailed).toHaveBeenCalledExactlyOnceWith("check");
  });

  it("should track each error kind at most once per session", () => {
    initAutoUpdater();
    emit("error", new Error("offline"));
    emit("error", new Error("offline again"));
    emit("update-available");
    emit("error", new Error("download failed"));
    emit("update-available");
    emit("error", new Error("download failed again"));
    expect(h.trackUpdateFailed).toHaveBeenCalledTimes(2);
    expect(h.trackUpdateFailed).toHaveBeenNthCalledWith(1, "check");
    expect(h.trackUpdateFailed).toHaveBeenNthCalledWith(2, "download");
  });
});
