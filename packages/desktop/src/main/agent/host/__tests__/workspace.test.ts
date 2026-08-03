import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// workspace.ts derives every agent path from two independent inputs: the
// workspace (from the env) and the resource dir (from the caller). The
// filesystem and homedir are the faked I/O boundaries.

const h = vi.hoisted(() => ({
  existsSync: vi.fn(),
  homedir: vi.fn(() => "/home/user"),
}));

vi.mock("node:fs", () => ({ existsSync: h.existsSync }));
vi.mock("node:os", () => ({ homedir: h.homedir }));

import { agentEnv, agentHostConfig, resolveWorkspaceDir, resourcePaths, workspacePaths } from "../workspace";

/** Run `fn` with ACCOUNTANT24_HOME set, restoring whatever was there before. */
function withHome<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.ACCOUNTANT24_HOME;
  if (value === undefined) delete process.env.ACCOUNTANT24_HOME;
  else process.env.ACCOUNTANT24_HOME = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.ACCOUNTANT24_HOME;
    else process.env.ACCOUNTANT24_HOME = prev;
  }
}

beforeEach(() => {
  h.existsSync.mockReset();
  h.existsSync.mockReturnValue(false);
  h.homedir.mockReset();
  h.homedir.mockReturnValue("/home/user");
});

describe("resolveWorkspaceDir()", () => {
  it("should use ACCOUNTANT24_HOME verbatim when it is a non-empty path", () => {
    expect(withHome("/custom/ws", resolveWorkspaceDir)).toBe("/custom/ws");
  });

  it("should fall back to <homedir>/Accountant24 when ACCOUNTANT24_HOME is unset", () => {
    h.homedir.mockReturnValue("/home/alice");
    expect(withHome(undefined, resolveWorkspaceDir)).toBe("/home/alice/Accountant24");
  });

  it("should fall back to the homedir default when ACCOUNTANT24_HOME is the empty string", () => {
    h.homedir.mockReturnValue("/home/bob");
    expect(withHome("", resolveWorkspaceDir)).toBe("/home/bob/Accountant24");
  });
});

describe("workspacePaths()", () => {
  it("should place every workspace path directly under the workspace", () => {
    expect(withHome("/ws", workspacePaths)).toEqual({
      workspaceDir: "/ws",
      sessionsDir: "/ws/sessions",
      skillsDir: "/ws/skills",
      mainJournalPath: "/ws/ledger/main.journal",
      appSettingsPath: "/ws/app-settings.json",
      legacySettingsPath: "/ws/settings.json",
    });
  });

  // Regression: the workspace derivation must not depend on the resource dir.
  // When it did, reading sessionsDir in a context with no resolvable app bundle
  // threw instead of returning a path.
  it("should resolve without any resource dir being available", () => {
    expect(() => withHome("/ws", workspacePaths)).not.toThrow();
    expect(withHome("/ws", workspacePaths).sessionsDir).toBe("/ws/sessions");
  });
});

describe("resourcePaths()", () => {
  it("should place every bundled asset directly under the resource dir", () => {
    expect(resourcePaths("/res")).toEqual({
      resourceDir: "/res",
      binDir: "/res/bin",
      extensionPath: "/res/accountant24-extension.js",
      systemPromptPath: "/res/system.md",
      nativeSkillsDir: "/res/skills",
      acpCommandPath: "/res/accountant24-acp",
    });
  });
});

describe("agentHostConfig()", () => {
  it("should assemble the host config from both derivations", () => {
    expect(agentHostConfig(withHome("/ws", workspacePaths), resourcePaths("/res"))).toEqual({
      workspaceDir: "/ws",
      sessionsDir: "/ws/sessions",
      skillsDir: "/ws/skills",
      nativeSkillsDir: "/res/skills",
      extensionPath: "/res/accountant24-extension.js",
      systemPromptPath: "/res/system.md",
    });
  });
});

describe("agentEnv()", () => {
  const build = () => agentEnv(withHome("/ws", workspacePaths), resourcePaths("/res"));

  it("should point ACCOUNTANT24_HOME and PI_CODING_AGENT_DIR at the workspace", () => {
    const env = build();
    expect(env.ACCOUNTANT24_HOME).toBe("/ws");
    expect(env.PI_CODING_AGENT_DIR).toBe("/ws");
  });

  it("should prepend binDir to PATH when the bin directory exists", () => {
    const prevPath = process.env.PATH;
    process.env.PATH = "/usr/bin";
    h.existsSync.mockImplementation((p: string) => p === `/res${path.sep}bin`);
    try {
      expect(build().PATH).toBe(`/res/bin${path.delimiter}/usr/bin`);
    } finally {
      process.env.PATH = prevPath;
    }
  });

  it("should leave PATH untouched when the bin directory is missing", () => {
    const prevPath = process.env.PATH;
    process.env.PATH = "/usr/bin";
    h.existsSync.mockReturnValue(false);
    try {
      expect(build().PATH).toBe("/usr/bin");
    } finally {
      process.env.PATH = prevPath;
    }
  });

  it("should set TESSDATA_PREFIX to <resourceDir>/tessdata when it exists", () => {
    h.existsSync.mockImplementation((p: string) => p === `/res${path.sep}tessdata`);
    expect(build().TESSDATA_PREFIX).toBe("/res/tessdata");
  });

  it("should omit TESSDATA_PREFIX when the tessdata directory is missing", () => {
    h.existsSync.mockReturnValue(false);
    expect(build().TESSDATA_PREFIX).toBeUndefined();
  });
});
