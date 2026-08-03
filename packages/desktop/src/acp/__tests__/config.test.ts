import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts resolves the resource dir without Electron and applies the agent env
// to this process. The filesystem and homedir are the faked I/O boundaries.

const h = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  homedir: vi.fn(() => "/home/user"),
}));

vi.mock("node:fs", () => ({
  existsSync: h.existsSync,
  readFileSync: h.readFileSync,
  mkdirSync: h.mkdirSync,
  writeFileSync: vi.fn(),
}));
vi.mock("node:os", () => ({ homedir: h.homedir }));

import { loadAcpConfig, resolveResourceDir } from "../config";

// The built entry lives at <root>/out/main/acp.js in both layouts; only where
// that root sits differs.
const MODULE_URL = "file:///repo/packages/desktop/out/main/acp.js";
const DEV_RESOURCES = "/repo/packages/desktop/resources";
const PACKAGED_URL = "file:///Apps/Accountant24.app/Contents/Resources/app/out/main/acp.js";
const PACKAGED_RESOURCES = "/Apps/Accountant24.app/Contents/Resources";

const ENV_KEYS = ["ACCOUNTANT24_RESOURCES", "ACCOUNTANT24_HOME", "PI_CODING_AGENT_DIR", "PATH", "TESSDATA_PREFIX"];
let saved: Record<string, string | undefined>;
let chdir: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.ACCOUNTANT24_RESOURCES;
  process.env.ACCOUNTANT24_HOME = "/ws";
  h.existsSync.mockReset();
  h.existsSync.mockReturnValue(false);
  h.readFileSync.mockReset();
  h.readFileSync.mockReturnValue("{}");
  h.homedir.mockReturnValue("/home/user");
  h.mkdirSync.mockReset();
  chdir = vi.spyOn(process, "chdir").mockImplementation(() => {});
});

afterEach(() => {
  chdir.mockRestore();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Mark a dir as a real resource dir (holding both bundled agent assets). */
function resourcesAt(dir: string) {
  h.existsSync.mockImplementation((p: string) => p === `${dir}/system.md` || p === `${dir}/accountant24-extension.js`);
}

describe("resolveResourceDir()", () => {
  it("should use ACCOUNTANT24_RESOURCES when the launcher set it", () => {
    process.env.ACCOUNTANT24_RESOURCES = "/explicit/res";
    expect(resolveResourceDir(MODULE_URL)).toBe("/explicit/res");
  });

  it("should ignore an empty ACCOUNTANT24_RESOURCES and probe instead", () => {
    process.env.ACCOUNTANT24_RESOURCES = "";
    resourcesAt(DEV_RESOURCES);
    expect(resolveResourceDir(MODULE_URL)).toBe(DEV_RESOURCES);
  });

  it("should find the dev layout at ../../resources", () => {
    resourcesAt(DEV_RESOURCES);
    expect(resolveResourceDir(MODULE_URL)).toBe(DEV_RESOURCES);
  });

  it("should find the packaged layout three levels above the entry", () => {
    resourcesAt(PACKAGED_RESOURCES);
    expect(resolveResourceDir(PACKAGED_URL)).toBe(PACKAGED_RESOURCES);
  });

  it("should prefer the dev layout when both probes would match", () => {
    h.existsSync.mockReturnValue(true);
    expect(resolveResourceDir(MODULE_URL)).toBe(DEV_RESOURCES);
  });

  it("should require both bundled assets, not just one", () => {
    h.existsSync.mockImplementation((p: string) => p === `${DEV_RESOURCES}/system.md`);
    // Neither candidate is complete, so it falls back to the first.
    expect(resolveResourceDir(MODULE_URL)).toBe(DEV_RESOURCES);
  });

  it("should fall back to the dev candidate when nothing is found", () => {
    h.existsSync.mockReturnValue(false);
    expect(resolveResourceDir(MODULE_URL)).toBe(DEV_RESOURCES);
  });
});

describe("loadAcpConfig()", () => {
  it("should assemble the agent host config from the workspace and resources", () => {
    process.env.ACCOUNTANT24_RESOURCES = "/res";
    expect(loadAcpConfig(MODULE_URL).host).toEqual({
      workspaceDir: "/ws",
      sessionsDir: "/ws/sessions",
      skillsDir: "/ws/skills",
      nativeSkillsDir: "/res/skills",
      extensionPath: "/res/accountant24-extension.js",
      systemPromptPath: "/res/system.md",
    });
  });

  // Load bearing: the extension spawns bare hledger/pdftotext/tesseract, so this
  // process must carry the vendored bin dir before the runtime loads it.
  it("should apply the agent env to this process", () => {
    process.env.ACCOUNTANT24_RESOURCES = "/res";
    process.env.PATH = "/usr/bin";
    h.existsSync.mockImplementation((p: string) => p === `/res${path.sep}bin` || p === `/res${path.sep}tessdata`);
    loadAcpConfig(MODULE_URL);
    expect(process.env.PATH).toBe(`/res/bin${path.delimiter}/usr/bin`);
    expect(process.env.TESSDATA_PREFIX).toBe("/res/tessdata");
    expect(process.env.PI_CODING_AGENT_DIR).toBe("/ws");
  });

  // pi stamps process.cwd() into every new session header, and the app lists
  // sessions filtered by that header. Without this the chats an ACP client
  // creates would be invisible in the app.
  it("should adopt the workspace as the working directory", () => {
    process.env.ACCOUNTANT24_RESOURCES = "/res";
    loadAcpConfig(MODULE_URL);
    expect(chdir).toHaveBeenCalledWith("/ws");
  });

  it("should create the sessions dir before adopting it", () => {
    process.env.ACCOUNTANT24_RESOURCES = "/res";
    loadAcpConfig(MODULE_URL);
    expect(h.mkdirSync).toHaveBeenCalledWith("/ws/sessions", { recursive: true });
  });

  it("should read defaultModel and enabledModels from app settings", () => {
    process.env.ACCOUNTANT24_RESOURCES = "/res";
    h.existsSync.mockImplementation((p: string) => p === "/ws/app-settings.json");
    h.readFileSync.mockReturnValue(
      JSON.stringify({ defaultModel: "anthropic/claude-sonnet-5", enabledModels: ["anthropic/claude-sonnet-5"] }),
    );
    const cfg = loadAcpConfig(MODULE_URL);
    expect(cfg.defaultModel).toBe("anthropic/claude-sonnet-5");
    expect(cfg.enabledModels).toEqual(["anthropic/claude-sonnet-5"]);
  });

  it("should leave defaultModel undefined when no settings file exists", () => {
    process.env.ACCOUNTANT24_RESOURCES = "/res";
    h.existsSync.mockReturnValue(false);
    expect(loadAcpConfig(MODULE_URL).defaultModel).toBeUndefined();
  });

  it("should report the version from the package.json above the built entry", () => {
    process.env.ACCOUNTANT24_RESOURCES = "/res";
    h.existsSync.mockReturnValue(false);
    h.readFileSync.mockImplementation((p: string) =>
      p === "/repo/packages/desktop/package.json" ? JSON.stringify({ version: "1.2.3" }) : "{}",
    );
    expect(loadAcpConfig(MODULE_URL).version).toBe("1.2.3");
  });

  it("should fall back to 0.0.0 when the package.json cannot be read", () => {
    process.env.ACCOUNTANT24_RESOURCES = "/res";
    h.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(loadAcpConfig(MODULE_URL).version).toBe("0.0.0");
  });

  it("should fall back to 0.0.0 when the package.json has no version", () => {
    process.env.ACCOUNTANT24_RESOURCES = "/res";
    h.existsSync.mockReturnValue(false);
    h.readFileSync.mockReturnValue(JSON.stringify({ name: "x" }));
    expect(loadAcpConfig(MODULE_URL).version).toBe("0.0.0");
  });
});
