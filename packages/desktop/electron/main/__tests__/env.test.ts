import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env.ts resolves resource paths. nodeRuntimePath() must pick the LSUIElement
// Helper binary on macOS (so the pi child never gets a Dock icon) and fall back
// to the main binary everywhere else. The filesystem, Electron's app object,
// and process.platform/execPath are the faked I/O boundaries.

const h = vi.hoisted(() => ({
  existsSync: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: true, getAppPath: () => "/app" },
}));
vi.mock("node:fs", () => ({ existsSync: h.existsSync }));

const realPlatform = process.platform;
const realExecPath = process.execPath;

function fakeProcess(platform: string, execPath: string) {
  Object.defineProperty(process, "platform", { value: platform });
  process.execPath = execPath;
}

async function nodeRuntimePath(): Promise<string> {
  const mod = await import("../env");
  return mod.nodeRuntimePath();
}

beforeEach(() => {
  vi.resetModules();
  h.existsSync.mockReset();
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform });
  process.execPath = realExecPath;
});

describe("nodeRuntimePath()", () => {
  it("should return the Plugin helper binary when it exists on macOS", async () => {
    fakeProcess("darwin", "/Applications/Accountant24.app/Contents/MacOS/Accountant24");
    h.existsSync.mockReturnValue(true);

    await expect(nodeRuntimePath()).resolves.toBe(
      "/Applications/Accountant24.app/Contents/Frameworks/Accountant24 Helper (Plugin).app/Contents/MacOS/Accountant24 Helper (Plugin)",
    );
  });

  it("should resolve the dev Electron.app helper from the electron dist binary", async () => {
    fakeProcess("darwin", "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
    h.existsSync.mockReturnValue(true);

    await expect(nodeRuntimePath()).resolves.toBe(
      "/repo/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper (Plugin).app/Contents/MacOS/Electron Helper (Plugin)",
    );
  });

  it("should fall back to process.execPath when the helper binary is missing", async () => {
    fakeProcess("darwin", "/Applications/Accountant24.app/Contents/MacOS/Accountant24");
    h.existsSync.mockReturnValue(false);

    await expect(nodeRuntimePath()).resolves.toBe("/Applications/Accountant24.app/Contents/MacOS/Accountant24");
  });

  it("should return process.execPath unchanged on non-macOS platforms", async () => {
    fakeProcess("linux", "/usr/lib/accountant24/accountant24");

    await expect(nodeRuntimePath()).resolves.toBe("/usr/lib/accountant24/accountant24");
    expect(h.existsSync).not.toHaveBeenCalled();
  });
});
