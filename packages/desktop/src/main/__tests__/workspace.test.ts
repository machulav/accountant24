// The fs and git are real (a temp ACCOUNTANT24_WORKSPACE via makeTmpWorkspace) — what
// the module leaves on disk is the whole point of it. Electron is the only faked
// boundary: the app metadata env.ts reads, and ipcMain/shell for the IPC.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ensureWorkspace, registerWorkspaceIpc } from "../workspace";
import { makeTmpWorkspace } from "./tmpWorkspace";

type Handler = (event: unknown, payload?: unknown) => unknown;
const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  openPath: vi.fn(() => Promise.resolve("")),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false, getAppPath: () => "/app" },
  ipcMain: { handle: (channel: string, fn: Handler) => h.handlers.set(channel, fn) },
  shell: { openPath: h.openPath },
}));

const ws = makeTmpWorkspace();
/** The workspace under test — a fresh temp dir for every test. */
let BASE = "";

/** Expected template files — mirrors the manifest in workspace.ts. */
const EXPECTED_TEMPLATE_FILES = [
  "memory.md",
  ".gitignore",
  "ledger/accounts.journal",
  "ledger/commodities.journal",
  "ledger/main.journal",
];

beforeEach(() => {
  BASE = ws.setup();
});

afterEach(() => {
  ws.cleanup();
});

/** `git log --oneline` over the workspace repo. */
function gitLog(args: string[] = []): string {
  return spawnSync("git", ["log", "--oneline", ...args], { cwd: BASE, encoding: "utf8" }).stdout ?? "";
}

describe("ensureWorkspace()", () => {
  test("should create ledger directory", async () => {
    await ensureWorkspace();
    expect(existsSync(join(BASE, "ledger"))).toBe(true);
  });

  test("should create sessions directory", async () => {
    await ensureWorkspace();
    expect(existsSync(join(BASE, "sessions"))).toBe(true);
  });

  test("should create files directory", async () => {
    await ensureWorkspace();
    expect(existsSync(join(BASE, "files"))).toBe(true);
  });

  test("should write main.journal with header and include directives", async () => {
    await ensureWorkspace();
    const content = readFileSync(join(BASE, "ledger", "main.journal"), "utf-8");
    expect(content).toContain("; Accountant24");
    expect(content).toContain("include commodities.journal");
    expect(content).toContain("include accounts.journal");
  });

  test("should create commodities.journal with header comment", async () => {
    await ensureWorkspace();
    expect(existsSync(join(BASE, "ledger", "commodities.journal"))).toBe(true);
    expect(readFileSync(join(BASE, "ledger", "commodities.journal"), "utf-8")).toContain("; Commodity declarations");
  });

  test("should not overwrite existing commodities.journal", async () => {
    mkdirSync(join(BASE, "ledger"), { recursive: true });
    writeFileSync(join(BASE, "ledger", "commodities.journal"), "commodity USD");

    await ensureWorkspace();

    expect(readFileSync(join(BASE, "ledger", "commodities.journal"), "utf-8")).toBe("commodity USD");
  });

  test("should write accounts.journal with semicolon comments", async () => {
    await ensureWorkspace();
    const content = readFileSync(join(BASE, "ledger", "accounts.journal"), "utf-8");
    expect(content).toContain("; Chart of accounts");
    expect(content).not.toMatch(/^#/m);
  });

  test("should write accounts.journal with all five account types", async () => {
    await ensureWorkspace();
    const content = readFileSync(join(BASE, "ledger", "accounts.journal"), "utf-8");
    expect(content).toContain("account Assets:");
    expect(content).toContain("account Liabilities:");
    expect(content).toContain("account Equity:");
    expect(content).toContain("account Income:");
    expect(content).toContain("account Expenses:");
  });

  test("should write accounts.journal with capitalized account names only", async () => {
    await ensureWorkspace();
    const content = readFileSync(join(BASE, "ledger", "accounts.journal"), "utf-8");
    const names = content.match(/^account (\S+)/gm) ?? [];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(/^account [A-Z]/);
    }
  });

  test("should keep expense accounts one level deep (high-level categories only)", async () => {
    await ensureWorkspace();
    const content = readFileSync(join(BASE, "ledger", "accounts.journal"), "utf-8");
    const expenseLines = content.split("\n").filter((l) => l.startsWith("account Expenses:"));
    expect(expenseLines.length).toBeGreaterThan(0);
    for (const line of expenseLines) {
      // Strip the inline comment, then require exactly one colon (Expenses:Category)
      const name = line
        .replace(/^account /, "")
        .split(";")[0]
        .trim();
      expect(name.match(/:/g)).toHaveLength(1);
    }
  });

  test("should write .gitignore with auth exclusion", async () => {
    await ensureWorkspace();
    const content = readFileSync(join(BASE, ".gitignore"), "utf-8");
    expect(content).toContain("auth.json");
  });

  test("should produce an output file for every template file", async () => {
    await ensureWorkspace();
    for (const relPath of EXPECTED_TEMPLATE_FILES) {
      expect(existsSync(join(BASE, relPath))).toBe(true);
    }
  });

  test("should not overwrite existing main.journal", async () => {
    mkdirSync(join(BASE, "ledger"), { recursive: true });
    writeFileSync(join(BASE, "ledger", "main.journal"), "existing content");

    await ensureWorkspace();

    expect(readFileSync(join(BASE, "ledger", "main.journal"), "utf-8")).toBe("existing content");
  });

  test("should not overwrite existing accounts.journal", async () => {
    mkdirSync(join(BASE, "ledger"), { recursive: true });
    writeFileSync(join(BASE, "ledger", "accounts.journal"), "user modified accounts");

    await ensureWorkspace();

    expect(readFileSync(join(BASE, "ledger", "accounts.journal"), "utf-8")).toBe("user modified accounts");
  });

  test("should not overwrite existing .gitignore", async () => {
    writeFileSync(join(BASE, ".gitignore"), "custom gitignore");

    await ensureWorkspace();

    expect(readFileSync(join(BASE, ".gitignore"), "utf-8")).toBe("custom gitignore");
  });

  test("should not create settings.json or models.json", async () => {
    await ensureWorkspace();
    expect(existsSync(join(BASE, "settings.json"))).toBe(false);
    expect(existsSync(join(BASE, "models.json"))).toBe(false);
  });

  test("should create empty memory.md", async () => {
    await ensureWorkspace();
    expect(existsSync(join(BASE, "memory.md"))).toBe(true);
    expect(readFileSync(join(BASE, "memory.md"), "utf-8")).toBe("");
  });

  test("should not overwrite existing memory.md", async () => {
    writeFileSync(join(BASE, "memory.md"), "user memories");

    await ensureWorkspace();

    expect(readFileSync(join(BASE, "memory.md"), "utf-8")).toBe("user memories");
  });

  test("should still create missing files when some already exist", async () => {
    mkdirSync(join(BASE, "ledger"), { recursive: true });
    writeFileSync(join(BASE, "ledger", "main.journal"), "custom main");

    await ensureWorkspace();

    // main.journal preserved
    expect(readFileSync(join(BASE, "ledger", "main.journal"), "utf-8")).toBe("custom main");
    // accounts.journal created because it was missing
    expect(existsSync(join(BASE, "ledger", "accounts.journal"))).toBe(true);
    // .gitignore created because it was missing
    expect(existsSync(join(BASE, ".gitignore"))).toBe(true);
  });

  test("should initialize a git repo", async () => {
    await ensureWorkspace();
    expect(existsSync(join(BASE, ".git"))).toBe(true);
  });

  test("should not reinitialize git repo on second run", async () => {
    await ensureWorkspace();
    const { statSync } = await import("node:fs");
    const firstGitTime = statSync(join(BASE, ".git")).birthtimeMs;

    await ensureWorkspace();
    const secondGitTime = statSync(join(BASE, ".git")).birthtimeMs;

    expect(secondGitTime).toBe(firstGitTime);
  });

  test("should create initial commit with scaffolded files", async () => {
    await ensureWorkspace();
    expect(gitLog(["-1"])).toContain("Initial Accountant24 setup");
  });

  test("should commit the seeded files", async () => {
    await ensureWorkspace();
    const tracked = spawnSync("git", ["ls-files"], { cwd: BASE, encoding: "utf8" }).stdout;
    expect(tracked).toContain("ledger/main.journal");
    expect(tracked).toContain("memory.md");
  });

  test("should not commit auth.json", async () => {
    mkdirSync(BASE, { recursive: true });
    writeFileSync(join(BASE, "auth.json"), "{}");

    await ensureWorkspace();

    const tracked = spawnSync("git", ["ls-files"], { cwd: BASE, encoding: "utf8" }).stdout;
    expect(tracked).not.toContain("auth.json");
  });

  test("should not create another commit on second run", async () => {
    await ensureWorkspace();
    await ensureWorkspace();
    const lines = gitLog()
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
  });

  test("should create the workspace root when it does not exist yet", async () => {
    const nested = join(BASE, "nested", ".accountant24");
    process.env.ACCOUNTANT24_WORKSPACE = nested;

    await ensureWorkspace();

    expect(existsSync(join(nested, "ledger", "main.journal"))).toBe(true);
  });
});

describe("registerWorkspaceIpc()", () => {
  beforeEach(() => {
    h.handlers.clear();
    h.openPath.mockReset();
    h.openPath.mockResolvedValue("");
    registerWorkspaceIpc();
  });

  test("should answer workspace_dir with the active workspace path", async () => {
    expect(await h.handlers.get("workspace_dir")?.({})).toBe(BASE);
  });

  test("should open the workspace folder in the file manager on workspace_open", async () => {
    await h.handlers.get("workspace_open")?.({});
    expect(h.openPath).toHaveBeenCalledTimes(1);
    expect(h.openPath).toHaveBeenCalledWith(BASE);
  });

  test("should reject workspace_open when the file manager reports an error", async () => {
    h.openPath.mockResolvedValue("No application can open this folder");
    await expect(h.handlers.get("workspace_open")?.({})).rejects.toThrow("No application can open this folder");
  });
});
