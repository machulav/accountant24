import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// cli.ts parses the app's launch flags and pins the workspace for the process.
// The filesystem and the home directory are the faked I/O boundaries; the env
// var it writes is the observable result.

const h = vi.hoisted(() => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  homedir: vi.fn(() => "/home/user"),
}));

vi.mock("node:fs", () => ({ existsSync: h.existsSync, statSync: h.statSync }));
vi.mock("node:os", () => ({ homedir: h.homedir }));

/** Run `fn` with ACCOUNTANT24_WORKSPACE set to `value` (or unset), restoring it after. */
async function withHome(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prev = process.env.ACCOUNTANT24_WORKSPACE;
  if (value === undefined) delete process.env.ACCOUNTANT24_WORKSPACE;
  else process.env.ACCOUNTANT24_WORKSPACE = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.ACCOUNTANT24_WORKSPACE;
    else process.env.ACCOUNTANT24_WORKSPACE = prev;
  }
}

beforeEach(() => {
  vi.resetModules();
  h.existsSync.mockReset();
  h.statSync.mockReset();
  h.homedir.mockReset();
  h.homedir.mockReturnValue("/home/user");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseWorkspaceFlag()", () => {
  it("should return undefined when argv has no --workspace", async () => {
    const { parseWorkspaceFlag } = await import("../cli");
    expect(parseWorkspaceFlag(["/bin/electron", ".", "--remote-debugging-port=9223"])).toBeUndefined();
  });

  it("should read the space-separated form `--workspace <path>`", async () => {
    const { parseWorkspaceFlag } = await import("../cli");
    expect(parseWorkspaceFlag(["/app/Accountant24", "--workspace", "/tmp/demo"])).toEqual({ path: "/tmp/demo" });
  });

  it("should read the equals form `--workspace=<path>`", async () => {
    const { parseWorkspaceFlag } = await import("../cli");
    expect(parseWorkspaceFlag(["/app/Accountant24", "--workspace=/tmp/demo"])).toEqual({ path: "/tmp/demo" });
  });

  it("should let the last occurrence win", async () => {
    const { parseWorkspaceFlag } = await import("../cli");
    expect(parseWorkspaceFlag(["x", "--workspace", "/one", "--workspace=/two"])).toEqual({ path: "/two" });
  });

  it("should ignore other switches around the flag", async () => {
    const { parseWorkspaceFlag } = await import("../cli");
    const argv = ["/bin/electron", ".", "--inspect=0", "--workspace", "/tmp/demo", "--remote-debugging-port=9224"];
    expect(parseWorkspaceFlag(argv)).toEqual({ path: "/tmp/demo" });
  });

  it("should report an error when --workspace is the last argument", async () => {
    const { parseWorkspaceFlag } = await import("../cli");
    expect(parseWorkspaceFlag(["x", "--workspace"])).toEqual({ error: expect.stringContaining("--workspace") });
  });

  it("should report an error when --workspace is followed by another switch", async () => {
    const { parseWorkspaceFlag } = await import("../cli");
    expect(parseWorkspaceFlag(["x", "--workspace", "--foo"])).toEqual({
      error: expect.stringContaining("--workspace"),
    });
  });

  it("should report an error for an empty `--workspace=`", async () => {
    const { parseWorkspaceFlag } = await import("../cli");
    expect(parseWorkspaceFlag(["x", "--workspace="])).toEqual({ error: expect.stringContaining("--workspace") });
  });

  it("should not mistake a prefixed switch like --workspaces for the flag", async () => {
    const { parseWorkspaceFlag } = await import("../cli");
    expect(parseWorkspaceFlag(["x", "--workspaces", "/tmp/demo"])).toBeUndefined();
  });
});

describe("applyWorkspaceFlag()", () => {
  it("should export an absolute --workspace path as ACCOUNTANT24_WORKSPACE and report the flag as the source", async () => {
    await withHome(undefined, async () => {
      const { applyWorkspaceFlag } = await import("../cli");
      h.existsSync.mockReturnValue(false);
      expect(applyWorkspaceFlag(["x", "--workspace", "/tmp/demo"])).toBe("flag");
      expect(process.env.ACCOUNTANT24_WORKSPACE).toBe("/tmp/demo");
    });
  });

  it("should let the flag override an ACCOUNTANT24_WORKSPACE that is already set", async () => {
    await withHome("/from/env", async () => {
      const { applyWorkspaceFlag } = await import("../cli");
      h.existsSync.mockReturnValue(false);
      expect(applyWorkspaceFlag(["x", "--workspace=/from/flag"])).toBe("flag");
      expect(process.env.ACCOUNTANT24_WORKSPACE).toBe("/from/flag");
    });
  });

  it("should expand a leading ~ against the home directory", async () => {
    await withHome(undefined, async () => {
      h.homedir.mockReturnValue("/home/erin");
      const { applyWorkspaceFlag } = await import("../cli");
      h.existsSync.mockReturnValue(false);
      applyWorkspaceFlag(["x", "--workspace", "~/Demo"]);
      expect(process.env.ACCOUNTANT24_WORKSPACE).toBe("/home/erin/Demo");
    });
  });

  it("should resolve a relative path against the current working directory", async () => {
    await withHome(undefined, async () => {
      const { applyWorkspaceFlag } = await import("../cli");
      h.existsSync.mockReturnValue(false);
      applyWorkspaceFlag(["x", "--workspace", "demo-ws"]);
      expect(process.env.ACCOUNTANT24_WORKSPACE).toBe(path.resolve("demo-ws"));
    });
  });

  it("should accept a folder that already exists", async () => {
    await withHome(undefined, async () => {
      const { applyWorkspaceFlag } = await import("../cli");
      h.existsSync.mockReturnValue(true);
      h.statSync.mockReturnValue({ isDirectory: () => true });
      expect(applyWorkspaceFlag(["x", "--workspace", "/tmp/existing"])).toBe("flag");
      expect(process.env.ACCOUNTANT24_WORKSPACE).toBe("/tmp/existing");
    });
  });

  it("should throw and leave the env untouched when the path exists but is a file", async () => {
    await withHome(undefined, async () => {
      const { applyWorkspaceFlag } = await import("../cli");
      h.existsSync.mockReturnValue(true);
      h.statSync.mockReturnValue({ isDirectory: () => false });
      expect(() => applyWorkspaceFlag(["x", "--workspace", "/tmp/notes.txt"])).toThrow(/\/tmp\/notes\.txt is a file/);
      expect(process.env.ACCOUNTANT24_WORKSPACE).toBeUndefined();
    });
  });

  it("should throw and leave the env untouched for a flag without a value", async () => {
    await withHome("/from/env", async () => {
      const { applyWorkspaceFlag } = await import("../cli");
      expect(() => applyWorkspaceFlag(["x", "--workspace"])).toThrow(/--workspace needs a folder path/);
      expect(process.env.ACCOUNTANT24_WORKSPACE).toBe("/from/env");
    });
  });

  it("should report the env var as the source when there is no flag but ACCOUNTANT24_WORKSPACE is set", async () => {
    await withHome("/from/env", async () => {
      const { applyWorkspaceFlag } = await import("../cli");
      expect(applyWorkspaceFlag(["x"])).toBe("env");
      expect(process.env.ACCOUNTANT24_WORKSPACE).toBe("/from/env");
    });
  });

  it("should report the default as the source when neither the flag nor the env var is set", async () => {
    await withHome(undefined, async () => {
      const { applyWorkspaceFlag } = await import("../cli");
      expect(applyWorkspaceFlag(["x"])).toBe("default");
      expect(process.env.ACCOUNTANT24_WORKSPACE).toBeUndefined();
    });
  });

  it("should treat an empty ACCOUNTANT24_WORKSPACE as unset when reporting the source", async () => {
    await withHome("", async () => {
      const { applyWorkspaceFlag } = await import("../cli");
      expect(applyWorkspaceFlag(["x"])).toBe("default");
    });
  });
});
