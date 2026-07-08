import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// updater.ts wires electron-updater into the silent-update flow: the
// shouldAutoUpdate gate (dev and rc builds must never self-update) plus the
// analytics classification (downloaded / check-error / download-error, deduped
// per session). Electron, electron-updater, and the analytics module (network)
// are the faked I/O boundaries.
type Handler = (payload?: unknown) => void;
type InvokeHandler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  isPackaged: false,
  version: "0.0.0",
  handlers: new Map<string, Handler>(),
  ipcHandlers: new Map<string, InvokeHandler>(),
  checkForUpdates: vi.fn(() => Promise.resolve()),
  quitAndInstall: vi.fn(),
  relaunch: vi.fn(),
  quit: vi.fn(),
  send: vi.fn(),
  trackUpdateDownloaded: vi.fn(),
  trackUpdateFailed: vi.fn(),
  trackUpdateInstallClicked: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return h.isPackaged;
    },
    getVersion: () => h.version,
    relaunch: h.relaunch,
    quit: h.quit,
  },
  ipcMain: {
    handle: (channel: string, fn: InvokeHandler) => {
      h.ipcHandlers.set(channel, fn);
    },
  },
}));
vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: {
      on: (event: string, fn: Handler) => {
        h.handlers.set(event, fn);
      },
      checkForUpdates: h.checkForUpdates,
      quitAndInstall: h.quitAndInstall,
    },
  },
}));
vi.mock("../analytics", () => ({
  trackUpdateDownloaded: h.trackUpdateDownloaded,
  trackUpdateFailed: h.trackUpdateFailed,
  trackUpdateInstallClicked: h.trackUpdateInstallClicked,
}));

import { shouldAutoUpdate } from "../updater";

// A fake main window whose webContents.send records the pushes to the renderer.
const getWin = () => ({ webContents: { send: h.send } }) as unknown as import("electron").BrowserWindow;

const emit = (event: string, payload?: unknown) => h.handlers.get(event)?.(payload);
const invoke = (channel: string, payload?: unknown) => h.ipcHandlers.get(channel)?.({}, payload);

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
  // Re-import per test so the module-level `downloadedVersion` (staged-update
  // state) starts null each time and doesn't leak across cases.
  let initAutoUpdater: (getWin: () => import("electron").BrowserWindow | null) => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.handlers.clear();
    h.ipcHandlers.clear();
    h.send.mockClear();
    h.quitAndInstall.mockClear();
    h.relaunch.mockClear();
    h.quit.mockClear();
    h.trackUpdateInstallClicked.mockClear();
    h.isPackaged = true;
    h.version = "1.0.0";
    delete process.env.A24_FAKE_UPDATE;
    vi.resetModules();
    ({ initAutoUpdater } = await import("../updater"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should register no update-event handlers and never check when running unpackaged", () => {
    h.isPackaged = false;
    initAutoUpdater(getWin);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(h.handlers.size).toBe(0);
    expect(h.checkForUpdates).not.toHaveBeenCalled();
  });

  it("should register no update-event handlers and never check for a prerelease version", () => {
    h.version = "1.1.0-rc.1";
    initAutoUpdater(getWin);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(h.handlers.size).toBe(0);
    expect(h.checkForUpdates).not.toHaveBeenCalled();
  });

  it("should check for updates 30s after launch and again every 4h", () => {
    initAutoUpdater(getWin);
    expect(h.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4 * 60 * 60 * 1000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("should survive a rejected check and still check again next cycle", async () => {
    h.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    initAutoUpdater(getWin);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(h.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("should track update_downloaded with the new version when a download completes", () => {
    initAutoUpdater(getWin);
    emit("update-available");
    emit("update-downloaded", { version: "1.1.0" });
    expect(h.trackUpdateDownloaded).toHaveBeenCalledExactlyOnceWith("1.1.0");
    expect(h.trackUpdateFailed).not.toHaveBeenCalled();
  });

  it("should push update-downloaded to the renderer with the new version", () => {
    initAutoUpdater(getWin);
    emit("update-downloaded", { version: "1.1.0" });
    expect(h.send).toHaveBeenCalledExactlyOnceWith("update-downloaded", "1.1.0");
  });

  it("should report no pending update before a download completes", () => {
    initAutoUpdater(getWin);
    expect(invoke("update_pending")).toBeNull();
  });

  it("should report the staged version via update_pending after a download completes", () => {
    initAutoUpdater(getWin);
    emit("update-downloaded", { version: "1.1.0" });
    expect(invoke("update_pending")).toBe("1.1.0");
  });

  it("should quit and install (not relaunch) when installing a staged update in a packaged build", () => {
    initAutoUpdater(getWin);
    emit("update-downloaded", { version: "1.1.0" });
    invoke("update_install");
    expect(h.quitAndInstall).toHaveBeenCalledOnce();
    expect(h.relaunch).not.toHaveBeenCalled();
    expect(h.trackUpdateInstallClicked).toHaveBeenCalledExactlyOnceWith("1.1.0");
  });

  it("should not quit and install when update_install is invoked with no staged update", () => {
    initAutoUpdater(getWin);
    invoke("update_install");
    expect(h.quitAndInstall).not.toHaveBeenCalled();
  });

  describe("dev preview (A24_FAKE_UPDATE)", () => {
    const importFresh = async () => {
      vi.resetModules();
      return (await import("../updater")).initAutoUpdater;
    };

    it("should stage the fake version and report it via update_pending", async () => {
      h.isPackaged = false;
      process.env.A24_FAKE_UPDATE = "9.9.9";
      const init = await importFresh();
      init(getWin);
      expect(invoke("update_pending")).toBe("9.9.9");
    });

    it("should push update-downloaded to the renderer after a short delay", async () => {
      h.isPackaged = false;
      process.env.A24_FAKE_UPDATE = "9.9.9";
      const init = await importFresh();
      init(getWin);
      expect(h.send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2_000);
      expect(h.send).toHaveBeenCalledExactlyOnceWith("update-downloaded", "9.9.9");
    });

    it("should relaunch (not quitAndInstall) when installing a dev preview update", async () => {
      h.isPackaged = false;
      process.env.A24_FAKE_UPDATE = "9.9.9";
      const init = await importFresh();
      init(getWin);
      invoke("update_install");
      expect(h.relaunch).toHaveBeenCalledOnce();
      expect(h.quit).toHaveBeenCalledOnce();
      expect(h.quitAndInstall).not.toHaveBeenCalled();
      // The preview is a testing artifact, so the real click event isn't sent.
      expect(h.trackUpdateInstallClicked).not.toHaveBeenCalled();
    });

    it("should stage nothing when the env var is absent in dev", async () => {
      h.isPackaged = false;
      const init = await importFresh();
      init(getWin);
      expect(invoke("update_pending")).toBeNull();
      vi.advanceTimersByTime(2_000);
      expect(h.send).not.toHaveBeenCalled();
    });
  });

  it("should track a check error when no update was being downloaded", () => {
    initAutoUpdater(getWin);
    emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(h.trackUpdateFailed).toHaveBeenCalledExactlyOnceWith("check");
  });

  it("should track a download error when the failure happens after update-available", () => {
    initAutoUpdater(getWin);
    emit("update-available");
    emit("error", new Error("sha512 checksum mismatch"));
    expect(h.trackUpdateFailed).toHaveBeenCalledExactlyOnceWith("download");
  });

  it("should classify an error after a completed download as a check error", () => {
    initAutoUpdater(getWin);
    emit("update-available");
    emit("update-downloaded", { version: "1.1.0" });
    emit("error", new Error("offline"));
    expect(h.trackUpdateFailed).toHaveBeenCalledExactlyOnceWith("check");
  });

  it("should track each error kind at most once per session", () => {
    initAutoUpdater(getWin);
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
