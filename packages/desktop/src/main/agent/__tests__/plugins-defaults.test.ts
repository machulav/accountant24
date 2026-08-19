import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// plugins-defaults installs the plugins a new workspace starts with, over the
// network, at startup. The network and Electron are faked; the store, the
// registry and app-settings.json are real, over a temp workspace.

type Skill = { name: string; description?: string };
type Fixture = { manifest?: unknown; skills?: Skill[] };

const h = vi.hoisted(() => ({
  ws: "",
  appVersion: "1.0.0",
  sendToWindow: vi.fn(),
  killAllAgents: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getVersion: () => h.appVersion, on: () => undefined },
  ipcMain: { handle: () => undefined },
}));
vi.mock("../../analytics", () => ({
  trackPluginAdded: vi.fn(),
  trackPluginAddFailed: vi.fn(),
  trackPluginRemoved: vi.fn(),
}));
vi.mock("../../env", () => ({
  workspaceDir: () => h.ws,
  pluginsDir: () => join(h.ws, "plugins"),
  appSettingsPath: () => join(h.ws, "app-settings.json"),
  legacySettingsPath: () => join(h.ws, "settings.json"),
}));
vi.mock("../router", () => ({ killAllAgents: h.killAllAgents }));

const win = { isDestroyed: () => false, webContents: { send: h.sendToWindow } };

// ---- fixtures ----------------------------------------------------------------

/** The default plugin's repository, as the module lists it. */
const REPO = "accountant24/skills";

const SKILLS: Fixture = {
  manifest: { name: "accountant24-skills", description: "The skills the app comes with." },
  skills: [{ name: "monthly-review", description: "Reviews the month." }],
};

/** Build a GitHub-shaped tarball: one wrapper dir holding the repo. */
async function buildTarball(fixture: Fixture): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "a24-default-fixture-"));
  const repo = join(dir, "accountant24-skills-0123abc");
  mkdirSync(repo, { recursive: true });
  if (fixture.manifest !== undefined) {
    writeFileSync(join(repo, "plugin.json"), JSON.stringify(fixture.manifest));
  }
  for (const skill of fixture.skills ?? []) {
    const skillDir = join(repo, "skills", skill.name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skill.name}\ndescription: ${skill.description ?? `The ${skill.name} skill.`}\n---\n`,
    );
  }
  const file = join(dir, "fixture.tgz");
  await tar.c({ gzip: true, file, cwd: dir }, ["accountant24-skills-0123abc"]);
  const bytes = readFileSync(file);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

/** Serve the plugin's tarball for any fetch, and count the calls. */
async function serve(fixture: Fixture = SKILLS): Promise<ReturnType<typeof vi.fn>> {
  const bytes = await buildTarball(fixture);
  const fetch = vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Serve an HTTP failure instead. */
function serveStatus(status: number): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async () => new Response("", { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Drop a plugin folder into the store, as a user's own install would. */
function addStorePlugin(name: string, skills: string[]): void {
  const dir = join(h.ws, "plugins", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name, description: `${name} plugin` }));
  for (const skill of skills) {
    const skillDir = join(dir, "skills", skill);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${skill}\ndescription: The ${skill} skill.\n---\n`);
  }
}

const settings = (): { plugins?: Record<string, { source?: string }>; defaultPluginsInstalled?: string[] } => {
  const path = join(h.ws, "app-settings.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
};
const installedRepos = () => settings().defaultPluginsInstalled ?? [];
const stored = (name: string) => existsSync(join(h.ws, "plugins", name));

// ---- setup -------------------------------------------------------------------

let mod: typeof import("../plugins-defaults");

beforeEach(async () => {
  h.ws = mkdtempSync(join(tmpdir(), "a24-defaults-ws-"));
  h.appVersion = "1.0.0";
  h.sendToWindow.mockClear();
  h.killAllAgents.mockClear();
  h.warn.mockClear();
  vi.spyOn(console, "warn").mockImplementation(h.warn);
  vi.resetModules();
  mod = await import("../plugins-defaults");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(h.ws, { recursive: true, force: true });
});

const run = () => mod.installDefaultPlugins(() => win as never);

// ---- a fresh workspace -------------------------------------------------------

describe("installDefaultPlugins()", () => {
  it("should install the default plugin into the store", async () => {
    await serve();

    await run();

    expect(stored("accountant24-skills")).toBe(true);
    expect(existsSync(join(h.ws, "plugins", "accountant24-skills", "skills", "monthly-review", "SKILL.md"))).toBe(true);
  });

  it("should record where it came from, so the row reads as an Accountant24 plugin", async () => {
    await serve();

    await run();

    expect(settings().plugins?.["accountant24-skills"]).toMatchObject({ source: REPO });
  });

  it("should record the repository as installed, so it is never installed twice", async () => {
    await serve();

    await run();

    expect(installedRepos()).toEqual([REPO]);
  });

  it("should restart the agent so the new skills reach the next message", async () => {
    await serve();

    await run();

    expect(h.killAllAgents).toHaveBeenCalledTimes(1);
  });

  it("should tell the window the store changed, so open lists reload", async () => {
    await serve();

    await run();

    expect(h.sendToWindow).toHaveBeenCalledWith("plugins-event", { type: "changed" });
  });

  it("should send no progress lines, since nobody asked for this install", async () => {
    await serve();

    await run();

    const progress = h.sendToWindow.mock.calls.filter(([, event]) => (event as { type: string }).type === "progress");
    expect(progress).toEqual([]);
  });

  it("should still install when the window is gone", async () => {
    await serve();

    await mod.installDefaultPlugins(() => null);

    expect(stored("accountant24-skills")).toBe(true);
    expect(h.sendToWindow).not.toHaveBeenCalled();
  });

  it("should stand aside while the user is installing something, and try again later", async () => {
    const plugins = await import("../plugins");
    const fetch = await serve();
    // Hold the install lock, as a user install in flight would.
    let release: () => void = () => {};
    const held = plugins.withInstallLock(() => new Promise<void>((resolve) => (release = resolve)));

    await run();
    expect(fetch).not.toHaveBeenCalled();
    expect(installedRepos()).toEqual([]);

    release();
    await held;
    await run();

    expect(stored("accountant24-skills")).toBe(true);
  });
});

// ---- once only ---------------------------------------------------------------

describe("installDefaultPlugins(), on later launches", () => {
  it("should not download again once the plugin is installed", async () => {
    const first = await serve();
    await run();
    expect(first).toHaveBeenCalledTimes(1);

    const second = await serve();
    await run();

    expect(second).not.toHaveBeenCalled();
  });

  it("should leave an uninstalled plugin uninstalled", async () => {
    await serve();
    await run();
    rmSync(join(h.ws, "plugins", "accountant24-skills"), { recursive: true, force: true });

    const again = await serve();
    await run();

    expect(again).not.toHaveBeenCalled();
    expect(stored("accountant24-skills")).toBe(false);
  });

  it("should not restart the agent when there is nothing to install", async () => {
    await serve();
    await run();
    h.killAllAgents.mockClear();

    await serve();
    await run();

    expect(h.killAllAgents).not.toHaveBeenCalled();
  });

  it("should skip a repository the user already installed themselves", async () => {
    writeFileSync(
      join(h.ws, "app-settings.json"),
      JSON.stringify({ plugins: { "some-name": { source: REPO, addedAt: "2026-01-01T00:00:00.000Z" } } }),
    );
    const fetch = await serve();

    await run();

    expect(fetch).not.toHaveBeenCalled();
    expect(installedRepos()).toEqual([REPO]);
  });
});

// ---- nothing of the user's is ever replaced ----------------------------------

describe("installDefaultPlugins(), against what the user already has", () => {
  it("should leave a plugin of the same name alone", async () => {
    addStorePlugin("accountant24-skills", ["mine"]);
    await serve();

    await run();

    expect(existsSync(join(h.ws, "plugins", "accountant24-skills", "skills", "mine", "SKILL.md"))).toBe(true);
    expect(existsSync(join(h.ws, "plugins", "accountant24-skills", "skills", "monthly-review"))).toBe(false);
  });

  it("should leave a plugin claiming one of its skill names alone", async () => {
    addStorePlugin("budget-pro", ["monthly-review"]);
    await serve();

    await run();

    expect(stored("accountant24-skills")).toBe(false);
    expect(stored("budget-pro")).toBe(true);
  });

  it("should stop trying once something of the user's stands in its place", async () => {
    addStorePlugin("budget-pro", ["monthly-review"]);
    await serve();
    await run();

    const again = await serve();
    await run();

    expect(again).not.toHaveBeenCalled();
  });
});

// ---- a launch that couldn't reach the network --------------------------------

describe("installDefaultPlugins(), when the download fails", () => {
  it("should install nothing when the machine is offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await run();

    expect(stored("accountant24-skills")).toBe(false);
    expect(installedRepos()).toEqual([]);
  });

  it("should report nothing to the window, since a first launch offline is normal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await run();

    expect(h.sendToWindow).not.toHaveBeenCalled();
    expect(h.killAllAgents).not.toHaveBeenCalled();
  });

  it("should try again on the next launch, and install once it works", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await run();

    await serve();
    await run();

    expect(stored("accountant24-skills")).toBe(true);
    expect(installedRepos()).toEqual([REPO]);
  });

  it("should try again after a rate limit", async () => {
    serveStatus(403);
    await run();

    const retry = await serve();
    await run();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(stored("accountant24-skills")).toBe(true);
  });

  it("should try again when the repository holds no plugin", async () => {
    await serve({ skills: [{ name: "monthly-review" }] });
    await run();
    expect(installedRepos()).toEqual([]);

    await serve();
    await run();

    expect(stored("accountant24-skills")).toBe(true);
  });

  it("should try again when the plugin needs a newer app", async () => {
    await serve({
      manifest: {
        name: "accountant24-skills",
        description: "Newer.",
        extensions: { "ai.accountant24": { minAppVersion: "99.0.0" } },
      },
      skills: [{ name: "monthly-review" }],
    });
    await run();
    expect(stored("accountant24-skills")).toBe(false);
    expect(installedRepos()).toEqual([]);

    h.appVersion = "99.0.0";
    await serve();
    await run();

    expect(stored("accountant24-skills")).toBe(true);
  });
});
