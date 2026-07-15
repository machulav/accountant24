import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env.ts resolves resource paths. nodeRuntimePath() must pick the LSUIElement
// Helper binary on macOS (so the pi child never gets a Dock icon) and fall back
// to the main binary everywhere else. The filesystem, Electron's app object,
// and process.platform/execPath are the faked I/O boundaries.

const h = vi.hoisted(() => ({
  existsSync: vi.fn(),
  // Mutable so a test can flip dev vs packaged without re-mocking the module.
  app: { isPackaged: true, getAppPath: (): string => "/app" },
  homedir: vi.fn(() => "/home/user"),
}));

vi.mock("electron", () => ({ app: h.app }));
vi.mock("node:fs", () => ({ existsSync: h.existsSync }));
vi.mock("node:os", () => ({ homedir: h.homedir }));

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
  h.app.isPackaged = true;
  h.app.getAppPath = () => "/app";
  h.homedir.mockReset();
  h.homedir.mockReturnValue("/home/user");
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform });
  process.execPath = realExecPath;
});

describe("workspace paths", () => {
  it("should all live directly under the workspace", async () => {
    const prev = process.env.ACCOUNTANT24_HOME;
    process.env.ACCOUNTANT24_HOME = "/ws";
    try {
      const mod = await import("../env");
      expect(mod.skillsDir()).toBe("/ws/skills");
      expect(mod.sessionsDir()).toBe("/ws/sessions");
      expect(mod.mainJournalPath()).toBe("/ws/ledger/main.journal");
      expect(mod.appSettingsPath()).toBe("/ws/app-settings.json");
      expect(mod.legacySettingsPath()).toBe("/ws/settings.json");
    } finally {
      if (prev === undefined) delete process.env.ACCOUNTANT24_HOME;
      else process.env.ACCOUNTANT24_HOME = prev;
    }
  });
});

describe("workspaceDir()", () => {
  it("should use ACCOUNTANT24_HOME verbatim when it is a non-empty path", async () => {
    const prev = process.env.ACCOUNTANT24_HOME;
    process.env.ACCOUNTANT24_HOME = "/custom/ws";
    try {
      const mod = await import("../env");
      expect(mod.workspaceDir()).toBe("/custom/ws");
    } finally {
      if (prev === undefined) delete process.env.ACCOUNTANT24_HOME;
      else process.env.ACCOUNTANT24_HOME = prev;
    }
  });

  it("should fall back to <homedir>/Accountant24 when ACCOUNTANT24_HOME is unset", async () => {
    const prev = process.env.ACCOUNTANT24_HOME;
    delete process.env.ACCOUNTANT24_HOME;
    h.homedir.mockReturnValue("/home/alice");
    try {
      const mod = await import("../env");
      expect(mod.workspaceDir()).toBe("/home/alice/Accountant24");
    } finally {
      if (prev === undefined) delete process.env.ACCOUNTANT24_HOME;
      else process.env.ACCOUNTANT24_HOME = prev;
    }
  });

  it("should fall back to the homedir default when ACCOUNTANT24_HOME is the empty string", async () => {
    const prev = process.env.ACCOUNTANT24_HOME;
    process.env.ACCOUNTANT24_HOME = "";
    h.homedir.mockReturnValue("/home/bob");
    try {
      const mod = await import("../env");
      expect(mod.workspaceDir()).toBe("/home/bob/Accountant24");
    } finally {
      if (prev === undefined) delete process.env.ACCOUNTANT24_HOME;
      else process.env.ACCOUNTANT24_HOME = prev;
    }
  });

  it("should place mainJournalPath under the homedir default workspace", async () => {
    const prev = process.env.ACCOUNTANT24_HOME;
    delete process.env.ACCOUNTANT24_HOME;
    h.homedir.mockReturnValue("/home/carol");
    try {
      const mod = await import("../env");
      expect(mod.mainJournalPath()).toBe("/home/carol/Accountant24/ledger/main.journal");
    } finally {
      if (prev === undefined) delete process.env.ACCOUNTANT24_HOME;
      else process.env.ACCOUNTANT24_HOME = prev;
    }
  });
});

describe("binDir()", () => {
  it("should resolve <resourcesPath>/bin when the app is packaged", async () => {
    h.app.isPackaged = true;
    const orig = process.resourcesPath;
    Object.defineProperty(process, "resourcesPath", { value: "/pkg-res", configurable: true });
    try {
      const mod = await import("../env");
      expect(mod.binDir()).toBe("/pkg-res/bin");
    } finally {
      Object.defineProperty(process, "resourcesPath", { value: orig, configurable: true });
    }
  });

  it("should resolve <appPath>/resources/bin in dev (unpackaged)", async () => {
    h.app.isPackaged = false;
    h.app.getAppPath = () => "/repo/packages/desktop";
    const mod = await import("../env");
    expect(mod.binDir()).toBe("/repo/packages/desktop/resources/bin");
  });
});

describe("agentEnv()", () => {
  it("should point ACCOUNTANT24_HOME and PI_CODING_AGENT_DIR at the workspace", async () => {
    const prev = process.env.ACCOUNTANT24_HOME;
    const origRes = process.resourcesPath;
    process.env.ACCOUNTANT24_HOME = "/ws";
    Object.defineProperty(process, "resourcesPath", { value: "/pkg-res", configurable: true });
    h.existsSync.mockReturnValue(false);
    try {
      const mod = await import("../env");
      const env = mod.agentEnv();
      expect(env.ACCOUNTANT24_HOME).toBe("/ws");
      expect(env.PI_CODING_AGENT_DIR).toBe("/ws");
    } finally {
      if (prev === undefined) delete process.env.ACCOUNTANT24_HOME;
      else process.env.ACCOUNTANT24_HOME = prev;
      Object.defineProperty(process, "resourcesPath", { value: origRes, configurable: true });
    }
  });

  it("should prepend binDir to PATH when the bin directory exists", async () => {
    h.app.isPackaged = true;
    const origRes = process.resourcesPath;
    const prevPath = process.env.PATH;
    Object.defineProperty(process, "resourcesPath", { value: "/pkg-res", configurable: true });
    process.env.PATH = "/usr/bin";
    // bin exists, tessdata does not.
    h.existsSync.mockImplementation((p: string) => p === `/pkg-res${path.sep}bin`);
    try {
      const mod = await import("../env");
      const env = mod.agentEnv();
      expect(env.PATH).toBe(`/pkg-res/bin${path.delimiter}/usr/bin`);
      expect(env.TESSDATA_PREFIX).toBeUndefined();
    } finally {
      Object.defineProperty(process, "resourcesPath", { value: origRes, configurable: true });
      process.env.PATH = prevPath;
    }
  });

  it("should leave PATH untouched when the bin directory is missing", async () => {
    h.app.isPackaged = true;
    const origRes = process.resourcesPath;
    const prevPath = process.env.PATH;
    Object.defineProperty(process, "resourcesPath", { value: "/pkg-res", configurable: true });
    process.env.PATH = "/usr/bin";
    h.existsSync.mockReturnValue(false);
    try {
      const mod = await import("../env");
      const env = mod.agentEnv();
      expect(env.PATH).toBe("/usr/bin");
    } finally {
      Object.defineProperty(process, "resourcesPath", { value: origRes, configurable: true });
      process.env.PATH = prevPath;
    }
  });

  it("should set TESSDATA_PREFIX to <resourceDir>/tessdata when it exists", async () => {
    h.app.isPackaged = true;
    const origRes = process.resourcesPath;
    Object.defineProperty(process, "resourcesPath", { value: "/pkg-res", configurable: true });
    // tessdata exists, bin does not.
    h.existsSync.mockImplementation((p: string) => p === `/pkg-res${path.sep}tessdata`);
    try {
      const mod = await import("../env");
      const env = mod.agentEnv();
      expect(env.TESSDATA_PREFIX).toBe("/pkg-res/tessdata");
    } finally {
      Object.defineProperty(process, "resourcesPath", { value: origRes, configurable: true });
    }
  });

  it("should omit TESSDATA_PREFIX when the tessdata directory is missing", async () => {
    h.app.isPackaged = true;
    const origRes = process.resourcesPath;
    Object.defineProperty(process, "resourcesPath", { value: "/pkg-res", configurable: true });
    h.existsSync.mockReturnValue(false);
    try {
      const mod = await import("../env");
      const env = mod.agentEnv();
      expect(env.TESSDATA_PREFIX).toBeUndefined();
    } finally {
      Object.defineProperty(process, "resourcesPath", { value: origRes, configurable: true });
    }
  });
});

describe("systemPromptPath()", () => {
  it("should resolve system.md in the packaged resources dir", async () => {
    const orig = process.resourcesPath;
    Object.defineProperty(process, "resourcesPath", { value: "/pkg-res", configurable: true });
    try {
      const mod = await import("../env");
      expect(mod.systemPromptPath()).toBe("/pkg-res/system.md");
    } finally {
      Object.defineProperty(process, "resourcesPath", { value: orig, configurable: true });
    }
  });
});

describe("nativeSkillsDir()", () => {
  it("should resolve the skills dir in the packaged resources dir", async () => {
    const orig = process.resourcesPath;
    Object.defineProperty(process, "resourcesPath", { value: "/pkg-res", configurable: true });
    try {
      const mod = await import("../env");
      expect(mod.nativeSkillsDir()).toBe("/pkg-res/skills");
    } finally {
      Object.defineProperty(process, "resourcesPath", { value: orig, configurable: true });
    }
  });
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
