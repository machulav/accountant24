import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// plugins.ts installs plugins from GitHub tarballs into the workspace store.
// The network (fetch) and Electron are the faked I/O boundaries; the pipeline —
// tar extraction, manifest validation, pi's skill loader, the store folders,
// and the registry inside app-settings.json — runs for real over a temp
// workspace.

type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  appListeners: new Map<string, () => void>(),
  handlers: new Map<string, Handler>(),
  sendToWindow: vi.fn(),
  ws: "",
  appVersion: "1.0.0",
  pluginInstallSucceeded: vi.fn(),
  pluginInstallFailed: vi.fn(),
  pluginUninstalled: vi.fn(),
}));

vi.mock("electron", () => ({
  // `on` collects app-lifecycle listeners; the will-quit one drops a staged copy.
  app: { getVersion: () => h.appVersion, on: (event: string, fn: () => void) => h.appListeners.set(event, fn) },
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
}));
vi.mock("../../analytics", () => ({
  trackPluginInstallSucceeded: h.pluginInstallSucceeded,
  trackPluginInstallFailed: h.pluginInstallFailed,
  trackPluginUninstalled: h.pluginUninstalled,
}));
vi.mock("../../env", () => ({
  workspaceDir: () => h.ws,
  pluginsDir: () => join(h.ws, "plugins"),
  appSettingsPath: () => join(h.ws, "app-settings.json"),
}));

const win = { isDestroyed: () => false, webContents: { send: h.sendToWindow } };

const invoke = (channel: string, payload?: unknown) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, payload);
};

type Result = { type: string; message?: string; name?: string };
type Preview = { name: string; repo: string; repoUrl: string; skills: { name: string }[]; version?: string };
type ListedPlugin = {
  name: string;
  enabled: boolean;
  native?: boolean;
  source?: string;
  repository?: string;
  error?: string;
  skills: { name: string; error?: string }[];
};

const list = () => (invoke("plugins_list") as { plugins: ListedPlugin[] }).plugins;
const registry = () => {
  const path = join(h.ws, "app-settings.json");
  if (!existsSync(path)) return undefined;
  return (JSON.parse(readFileSync(path, "utf8")) as { plugins?: Record<string, unknown> }).plugins;
};

// ---- fixtures ----------------------------------------------------------------

interface FixtureSkill {
  name: string;
  description?: string;
  extra?: string;
}

interface Fixture {
  /** Written as plugin.json; omitted entirely when absent. */
  manifest?: unknown;
  skills?: FixtureSkill[];
  /** Nest the plugin under this repo subdirectory. */
  subdir?: string;
}

/** Build a GitHub-shaped tarball: one wrapper dir (owner-repo-sha/) holding a
 *  repo whose contents are the given fixture. */
async function buildTarball(fixture: Fixture): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "a24-plugin-fixture-"));
  try {
    const repo = join(dir, "owner-repo-0123abc");
    const base = fixture.subdir ? join(repo, fixture.subdir) : repo;
    mkdirSync(base, { recursive: true });
    writeFileSync(join(repo, "README.md"), "# repo\n");
    if (fixture.manifest !== undefined) {
      writeFileSync(join(base, "plugin.json"), JSON.stringify(fixture.manifest));
    }
    for (const skill of fixture.skills ?? []) {
      const skillDir = join(base, "skills", skill.name);
      mkdirSync(skillDir, { recursive: true });
      const description = skill.description === undefined ? `The ${skill.name} skill.` : skill.description;
      const frontmatter = description
        ? `---\nname: ${skill.name}\ndescription: ${description}\n---\n`
        : `---\nname: ${skill.name}\n---\n`;
      writeFileSync(join(skillDir, "SKILL.md"), `${frontmatter}# ${skill.name}\n`);
      if (skill.extra) writeFileSync(join(skillDir, "reference.md"), skill.extra);
    }
    const file = join(dir, "fixture.tgz");
    await tar.c({ gzip: true, file, cwd: dir }, ["owner-repo-0123abc"]);
    return readFileSync(file);
  } finally {
    // The tarball bytes are in memory; the staging dir can go.
    setTimeout(() => rmSync(dir, { recursive: true, force: true }), 0);
  }
}

/** The plugin most tests install: two skills and one extra asset. */
const BUDGET: Fixture = {
  manifest: {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "budget",
    description: "Budget reviews.",
    version: "1.1.0",
    author: { name: "Ada" },
  },
  skills: [
    { name: "monthly-review", description: "Reviews the month.", extra: "notes\n" },
    { name: "yearly-review", description: "Reviews the year." },
  ],
};

/** Serve a tarball for any fetch. */
async function serve(fixture: Fixture): Promise<void> {
  const bytes = await buildTarball(fixture);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })),
  );
}

/** Serve an HTTP error instead of a tarball. */
function serveStatus(status: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status })),
  );
}

/** Drop a plugin into the store, standing in for one the app seeded there. */
function addNativePlugin(name: string, skills: string[], description = "Seeded."): void {
  const dir = join(h.ws, "plugins", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name, description }),
  );
  for (const skill of skills) {
    const skillDir = join(dir, "skills", skill);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${skill}\ndescription: The ${skill} skill.\n---\n`);
  }
}

/** Drop a plugin folder straight into the store, as a user or the agent would. */
function addStorePlugin(name: string, skills: string[]): void {
  const dir = join(h.ws, "plugins", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name,
      description: `${name} plugin`,
    }),
  );
  for (const skill of skills) {
    const skillDir = join(dir, "skills", skill);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${skill}\ndescription: The ${skill} skill.\n---\n`);
  }
}

/** Fetch, then install — the two steps the Settings dialog runs. */
async function install(source = "owner/repo"): Promise<Result> {
  const inspected = (await invoke("plugins_inspect", { source })) as Result;
  if (inspected.type !== "plugin") return inspected;
  return invoke("plugins_add") as Result;
}

// ---- setup -------------------------------------------------------------------

let mod: typeof import("../plugins");

beforeEach(async () => {
  h.handlers.clear();
  for (const fn of [h.pluginInstallSucceeded, h.pluginInstallFailed, h.pluginUninstalled]) {
    fn.mockClear();
  }
  h.sendToWindow.mockClear();
  h.appVersion = "1.0.0";
  h.ws = mkdtempSync(join(tmpdir(), "a24-plugins-ws-"));
  vi.resetModules();
  mod = await import("../plugins");
  mod.registerPluginsIpc(() => win as never);
});

afterEach(() => {
  mod.resetStagedPlugin();
  vi.unstubAllGlobals();
  rmSync(h.ws, { recursive: true, force: true });
});

// ---- plugins_list ------------------------------------------------------------

describe("plugins_list", () => {
  it("should return an empty list for a fresh workspace", () => {
    expect(list()).toEqual([]);
  });

  it("should list the repository a plugin's manifest declares", () => {
    const dir = join(h.ws, "plugins", "budget");
    mkdirSync(join(dir, "skills", "review"), { recursive: true });
    writeFileSync(
      join(dir, "plugin.json"),
      JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "budget",
        description: "Budget reviews.",
        repository: "https://github.com/acme/budget",
      }),
    );
    writeFileSync(join(dir, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: d\n---\n");

    expect(list()[0].repository).toBe("https://github.com/acme/budget");
  });

  it("should list every plugin in the store, in folder order", () => {
    addNativePlugin("accountant24", ["recurring-spending"], "Money reviews.");
    addStorePlugin("budget", ["monthly-review"]);

    expect(list()).toEqual([
      {
        name: "accountant24",
        description: "Money reviews.",
        skills: [{ name: "accountant24:recurring-spending", description: "The recurring-spending skill." }],
      },
      {
        name: "budget",
        description: "budget plugin",
        skills: [{ name: "budget:monthly-review", description: "The monthly-review skill." }],
      },
    ]);
  });

  it("should namespace every skill under its plugin", () => {
    addStorePlugin("budget", ["review", "forecast"]);
    expect(list()[0].skills.map((s) => s.name)).toEqual(["budget:forecast", "budget:review"]);
  });

  it("should report a plugin folder whose manifest is invalid", () => {
    const dir = join(h.ws, "plugins", "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), "{oops");
    expect(list()[0]).toMatchObject({ name: "broken", error: "plugin.json is not valid JSON." });
  });

  it("should report a skill a built-in plugin already claims", () => {
    addNativePlugin("accountant24", ["review"]);
    addStorePlugin("budget", ["review"]);

    const budget = list().find((p) => p.name === "budget");
    expect(budget?.skills).toEqual([
      {
        name: "budget:review",
        description: "The review skill.",
        error: "Skill name already used by the accountant24 plugin.",
      },
    ]);
  });

  it("should let a built-in keep a skill name a plugin installed earlier also uses", async () => {
    // The community plugin sorts first alphabetically and was installed while
    // nothing claimed the name; the seed then brought the official one.
    addStorePlugin("aaa-tools", ["monthly-review"]);
    addNativePlugin("accountant24-skills", ["monthly-review"]);
    writeFileSync(
      join(h.ws, "app-settings.json"),
      JSON.stringify({
        plugins: { "accountant24-skills": { source: "accountant24/skills", addedAt: "2026-01-01T00:00:00.000Z" } },
      }),
    );

    const official = list().find((p) => p.name === "accountant24-skills");
    const community = list().find((p) => p.name === "aaa-tools");
    expect(official?.skills[0]).toEqual({
      name: "accountant24-skills:monthly-review",
      description: expect.any(String),
    });
    expect(community?.skills[0]?.error).toBe("Skill name already used by the accountant24-skills plugin.");
    expect(mod.agentSkills().map((s) => s.name)).toContain("accountant24-skills:monthly-review");
  });

  it("should recognize its own plugin however the repository owner is capitalized", async () => {
    // GitHub owners are case-insensitive and the index reports the account's
    // own casing, so the source can land in the registry as "Accountant24/…".
    addStorePlugin("aaa-tools", ["monthly-review"]);
    addNativePlugin("accountant24-skills", ["monthly-review"]);
    writeFileSync(
      join(h.ws, "app-settings.json"),
      JSON.stringify({
        plugins: { "accountant24-skills": { source: "Accountant24/Skills", addedAt: "2026-01-01T00:00:00.000Z" } },
      }),
    );

    const community = list().find((p) => p.name === "aaa-tools");
    expect(community?.skills[0]?.error).toBe("Skill name already used by the accountant24-skills plugin.");
    expect(mod.agentSkills().map((s) => s.name)).toEqual(["accountant24-skills:monthly-review"]);
  });

  it("should forget provenance for a plugin folder that is gone", async () => {
    await serve(BUDGET);
    await install();
    expect(registry()).toHaveProperty("budget");

    rmSync(join(h.ws, "plugins", "budget"), { recursive: true, force: true });
    list();

    // Left behind, a later folder of that name would inherit the repository
    // (and the Official badge that follows from it).
    expect(registry()).toEqual({});
  });

  it("should report where an installed plugin came from", async () => {
    await serve(BUDGET);
    await install();
    expect(list()[0]).toMatchObject({ name: "budget", source: "owner/repo", version: "1.1.0" });
  });
});

// ---- agentSkills -------------------------------------------------------------

describe("agentSkills()", () => {
  it("should give the host every skill with its namespaced name", () => {
    addNativePlugin("accountant24", ["recurring-spending"]);
    expect(mod.agentSkills()).toEqual([
      {
        path: join(h.ws, "plugins", "accountant24", "skills", "recurring-spending"),
        name: "accountant24:recurring-spending",
      },
    ]);
  });

  it("should include every installed plugin, since being in the store is what makes one active", () => {
    addStorePlugin("budget", ["review"]);
    expect(mod.agentSkills()).toEqual([
      { path: join(h.ws, "plugins", "budget", "skills", "review"), name: "budget:review" },
    ]);
  });

  it("should drop a skill whose raw name a built-in plugin already claims", () => {
    addNativePlugin("accountant24", ["review"]);
    addStorePlugin("budget", ["review", "forecast"]);
    expect(mod.agentSkills().map((s) => s.name)).toEqual(["accountant24:review", "budget:forecast"]);
  });

  it("should exclude a plugin that failed to load", () => {
    const dir = join(h.ws, "plugins", "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), "{oops");
    expect(mod.agentSkills()).toEqual([]);
  });
});

// ---- plugins_inspect ---------------------------------------------------------

describe("plugins_inspect", () => {
  it("should report what the repository contains without touching the store", async () => {
    await serve(BUDGET);
    const result = (await invoke("plugins_inspect", { source: "owner/repo" })) as {
      type: string;
      plugin: Preview;
    };

    expect(result.type).toBe("plugin");
    expect(result.plugin).toEqual({
      name: "budget",
      description: "Budget reviews.",
      version: "1.1.0",
      author: "Ada",
      repo: "owner/repo",
      repoUrl: "https://github.com/owner/repo",
      skills: [
        { name: "budget:monthly-review", description: "Reviews the month." },
        { name: "budget:yearly-review", description: "Reviews the year." },
      ],
    });
    expect(existsSync(join(h.ws, "plugins"))).toBe(false);
  });

  it("should stream progress lines to the window while it works", async () => {
    await serve(BUDGET);
    await invoke("plugins_inspect", { source: "owner/repo" });
    expect(h.sendToWindow.mock.calls.map((c) => (c[1] as { message: string }).message)).toEqual([
      "Downloading owner/repo…",
      "Extracting…",
    ]);
  });

  it("should reject a source that is not a plain owner/repo", async () => {
    const result = (await invoke("plugins_inspect", { source: "https://example.com/x" })) as Result;
    expect(result).toEqual({ type: "error", message: "Not a GitHub repository: https://example.com/x" });
    expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "invalid_source");
  });

  it("should reject a repository URL carrying a ref or a subdirectory", async () => {
    const result = (await invoke("plugins_inspect", {
      source: "https://github.com/owner/repo/tree/v2/plugins/budget",
    })) as Result;
    expect(result).toMatchObject({ type: "error" });
    expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "invalid_source");
  });

  it("should reject a repository without a manifest", async () => {
    await serve({ skills: [{ name: "review" }] });
    const result = (await invoke("plugins_inspect", { source: "owner/repo" })) as Result;
    expect(result).toEqual({
      type: "error",
      message: "No plugin found in owner/repo: a plugin needs a plugin.json file.",
    });
    expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "no_plugin");
  });

  it("should reject a manifest the format does not allow", async () => {
    await serve({
      manifest: { $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "com.example.budget" },
      skills: [{ name: "review" }],
    });
    const result = (await invoke("plugins_inspect", { source: "owner/repo" })) as Result;
    expect(result).toEqual({
      type: "error",
      message: "plugin.json: name may only contain lowercase letters, numbers, and hyphens.",
    });
    expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "invalid_plugin");
  });

  it("should reject a plugin with no skills", async () => {
    await serve({
      manifest: {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "budget",
        description: "Budget reviews.",
      },
    });
    const result = (await invoke("plugins_inspect", { source: "owner/repo" })) as Result;
    expect(result).toEqual({ type: "error", message: "Plugin has no skills." });
  });

  it("should reject a plugin that needs a newer app", async () => {
    h.appVersion = "1.0.0";
    await serve({
      manifest: {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "budget",
        description: "Budget reviews.",
        extensions: { "ai.accountant24": { minAppVersion: "2.0.0" } },
      },
      skills: [{ name: "review" }],
    });
    const result = (await invoke("plugins_inspect", { source: "owner/repo" })) as Result;
    expect(result).toEqual({
      type: "error",
      message: "budget needs Accountant24 v2.0.0 or newer. Update the app and try again.",
    });
    expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "app_too_old");
  });

  it("should accept a plugin whose minimum app version this build meets", async () => {
    h.appVersion = "2.0.0";
    await serve({
      manifest: {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "budget",
        description: "Budget reviews.",
        extensions: { "ai.accountant24": { minAppVersion: "2.0.0" } },
      },
      skills: [{ name: "review" }],
    });
    expect(((await invoke("plugins_inspect", { source: "owner/repo" })) as Result).type).toBe("plugin");
  });

  it("should report a repository that does not exist", async () => {
    serveStatus(404);
    const result = (await invoke("plugins_inspect", { source: "owner/repo" })) as Result;
    expect(result).toEqual({ type: "error", message: "Repository not found: owner/repo" });
    expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "not_found");
  });

  it("should report a rate limit in terms the user can act on", async () => {
    serveStatus(403);
    const result = (await invoke("plugins_inspect", { source: "owner/repo" })) as Result;
    expect(result).toEqual({
      type: "error",
      message: "GitHub rate limit reached — try again in a few minutes.",
    });
    expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "fetch_failed");
  });

  it("should report any other GitHub failure with its status", async () => {
    serveStatus(500);
    const result = (await invoke("plugins_inspect", { source: "owner/repo" })) as Result;
    expect(result).toEqual({ type: "error", message: "GitHub returned 500 for owner/repo." });
  });

  it("should report a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const result = (await invoke("plugins_inspect", { source: "owner/repo" })) as Result;
    expect(result).toEqual({ type: "error", message: "offline" });
    expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "fetch_failed");
  });

  it("should record where the plugin came from in the settings registry", async () => {
    await serve(BUDGET);
    await install();
    expect(registry()).toEqual({
      budget: {
        source: "owner/repo",
        commit: "0123abc",
        addedAt: expect.any(String),
      },
    });
  });

  it("should count the install once it lands", async () => {
    await serve(BUDGET);
    await install();
    expect(h.pluginInstallSucceeded).toHaveBeenCalledWith("marketplace", false, 2);
  });

  it("should count an install from our own account as official", async () => {
    await serve(BUDGET);
    await install("Accountant24/Budget");
    expect(h.pluginInstallSucceeded).toHaveBeenCalledWith("marketplace", true, 2);
  });

  it("should refuse a second read while one is already running", async () => {
    await serve(BUDGET);
    const first = invoke("plugins_inspect", { source: "owner/repo" });
    expect(invoke("plugins_add")).toEqual({
      type: "error",
      message: "Another plugin is already being installed.",
    });
    await first;
  });

  it("should refuse to install before anything has been inspected", () => {
    expect(invoke("plugins_add")).toEqual({
      type: "error",
      message: "Nothing to install — inspect the repository first.",
    });
  });

  it("should refuse a second install once the staged plugin has landed", async () => {
    await serve(BUDGET);
    await install();
    expect(invoke("plugins_add")).toEqual({
      type: "error",
      message: "Nothing to install — inspect the repository first.",
    });
  });

  it("should keep the plugin installable after a refusal is resolved", async () => {
    addStorePlugin("budget", ["review"]);
    await serve(BUDGET);
    // Blocked: a folder of that name is already in the workspace.
    expect(await install()).toMatchObject({ type: "error" });
    invoke("plugins_remove", { name: "budget" });
    // The inspected copy is still staged, so installing now works without
    // fetching the repository again.
    expect(invoke("plugins_add")).toEqual({ type: "done", name: "budget" });
  });

  it("should refuse a name a hand-dropped plugin already uses", async () => {
    addStorePlugin("budget", ["something-else"]);
    await serve(BUDGET);
    expect(await install()).toEqual({
      type: "error",
      message: "A plugin folder named budget is already in your workspace.",
    });
    expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "collision");
  });

  it("should refuse to clobber a plugin installed from another repository", async () => {
    await serve(BUDGET);
    await install("owner/repo");
    await serve(BUDGET);
    expect(await install("other/repo")).toEqual({
      type: "error",
      message: "budget is already installed from owner/repo.",
    });
  });

  it("should refuse to clobber a hand-dropped plugin folder", async () => {
    addStorePlugin("budget", ["review"]);
    await serve(BUDGET);
    expect(await install()).toEqual({
      type: "error",
      message: "A plugin folder named budget is already in your workspace.",
    });
  });

  it("should reinstall over the same repository, replacing what was there", async () => {
    await serve(BUDGET);
    await install();
    await serve({
      manifest: {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "budget",
        description: "Budget reviews.",
      },
      skills: [{ name: "monthly-review" }],
    });
    expect(await install()).toEqual({ type: "done", name: "budget" });
    expect(existsSync(join(h.ws, "plugins", "budget", "skills", "yearly-review"))).toBe(false);
  });

  it("should refuse a plugin whose skill name another plugin already provides", async () => {
    addNativePlugin("accountant24", ["monthly-review"]);
    await serve(BUDGET);
    expect(await install()).toEqual({
      type: "error",
      message: "The skill monthly-review is already provided by the accountant24 plugin.",
    });
    expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "collision");
  });

  it("should leave the store untouched when an install is refused", async () => {
    addNativePlugin("accountant24", ["monthly-review"]);
    await serve(BUDGET);
    await install();
    expect(existsSync(join(h.ws, "plugins", "budget"))).toBe(false);
  });

  it("should not write a registry entry when an install is refused", async () => {
    addNativePlugin("budget", ["x"]);
    await serve(BUDGET);
    await install();
    expect(existsSync(join(h.ws, "app-settings.json"))).toBe(false);
  });

  it("should report an install that fails while writing to the store", async () => {
    // A store the app can list but not write into (read + execute, no write)
    // stands in for any mid-copy filesystem failure.
    const root = join(h.ws, "plugins");
    mkdirSync(root, { recursive: true });
    chmodSync(root, 0o500);
    try {
      await serve(BUDGET);
      const result = await install();
      expect(result.type).toBe("error");
      expect(h.pluginInstallFailed).toHaveBeenCalledWith("marketplace", "other");
    } finally {
      chmodSync(root, 0o700);
    }
  });

  it("should keep other plugins' registry entries when one is installed", async () => {
    await serve({
      manifest: {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "taxes",
        description: "Tax estimates.",
      },
      skills: [{ name: "estimate" }],
    });
    await install("owner/taxes");
    await serve(BUDGET);
    await install();
    expect(Object.keys(registry() ?? {}).sort()).toEqual(["budget", "taxes"]);
  });
});

// ---- plugins_remove ----------------------------------------------------------

describe("plugins_remove", () => {
  it("should delete the folder and forget the plugin", async () => {
    await serve(BUDGET);
    await install();
    expect(invoke("plugins_remove", { name: "budget" })).toEqual({ type: "done", name: "budget" });
    expect(existsSync(join(h.ws, "plugins", "budget"))).toBe(false);
    expect(registry()).toEqual({});
    expect(h.pluginUninstalled).toHaveBeenCalledWith(false);
  });

  it("should record whose plugin was uninstalled before the provenance goes", async () => {
    await serve(BUDGET);
    await install("accountant24/budget");
    invoke("plugins_remove", { name: "budget" });
    expect(h.pluginUninstalled).toHaveBeenCalledWith(true);
  });

  it("should uninstall a plugin the app seeded, like any other", () => {
    addNativePlugin("accountant24-skills", ["review"]);
    expect(invoke("plugins_remove", { name: "accountant24-skills" })).toEqual({
      type: "done",
      name: "accountant24-skills",
    });
    expect(existsSync(join(h.ws, "plugins", "accountant24-skills"))).toBe(false);
  });

  it("should refuse a name that is a path", () => {
    expect(invoke("plugins_remove", { name: "../elsewhere" })).toEqual({
      type: "error",
      message: "invalid plugin name",
    });
  });

  it("should refuse an empty name", () => {
    expect(invoke("plugins_remove", { name: "" })).toEqual({ type: "error", message: "invalid plugin name" });
  });

  it("should drop the staged copy when the app quits", async () => {
    const unpacked = () => readdirSync(tmpdir()).filter((name) => name.startsWith("a24-plugin-"));
    const before = new Set(unpacked());
    await serve(BUDGET);
    await invoke("plugins_inspect", { source: "owner/repo" });
    const [staged] = unpacked().filter((name) => !before.has(name));
    expect(staged).toBeDefined();

    h.appListeners.get("will-quit")?.();

    expect(existsSync(join(tmpdir(), staged as string))).toBe(false);
  });

  it("should refuse a hidden name", () => {
    expect(invoke("plugins_remove", { name: ".git" })).toEqual({ type: "error", message: "invalid plugin name" });
  });

  it("should delete nothing outside the store", () => {
    const outside = join(h.ws, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "ledger.journal"), "; mine\n");

    // A name that survives the segment check but resolves elsewhere.
    expect(invoke("plugins_remove", { name: `..${sep}outside` })).toEqual({
      type: "error",
      message: "invalid plugin name",
    });
    expect(existsSync(join(outside, "ledger.journal"))).toBe(true);
  });

  it("should keep other plugins' registry entries", async () => {
    await serve({
      manifest: {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "taxes",
        description: "Tax estimates.",
      },
      skills: [{ name: "estimate" }],
    });
    await install("owner/taxes");
    await serve(BUDGET);
    await install();
    invoke("plugins_remove", { name: "budget" });
    expect(Object.keys(registry() ?? {})).toEqual(["taxes"]);
  });
});
