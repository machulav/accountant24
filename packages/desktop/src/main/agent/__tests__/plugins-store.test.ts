import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  effectiveSkillName,
  hostSkills,
  listPluginFolders,
  parseGitHubSource,
  readPlugin,
  readPluginDir,
  readPlugins,
  resolveSkills,
  type StoredPlugin,
} from "../plugins-store";

// The store is a plain reader over plugin folders, so these run against real
// directories in a temp dir rather than a mocked filesystem.

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "a24-plugins-store-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write a plugin folder: a manifest plus one skill per entry. */
function writePlugin(
  folder: string,
  options: {
    name?: string;
    manifest?: string;
    description?: string;
    skills?: { name: string; description?: string; frontmatterName?: string }[];
  } = {},
): string {
  const dir = join(root, folder);
  mkdirSync(dir, { recursive: true });
  const manifest =
    options.manifest ??
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: options.name ?? folder,
      description: options.description ?? "Does plugin things.",
    });
  writeFileSync(join(dir, "plugin.json"), manifest);
  for (const skill of options.skills ?? []) {
    const skillDir = join(dir, "skills", skill.name);
    mkdirSync(skillDir, { recursive: true });
    const frontmatterName = skill.frontmatterName ?? skill.name;
    const description = skill.description === undefined ? "Does a thing." : skill.description;
    const frontmatter = description
      ? `---\nname: ${frontmatterName}\ndescription: ${description}\n---\n`
      : `---\nname: ${frontmatterName}\n---\n`;
    writeFileSync(join(skillDir, "SKILL.md"), `${frontmatter}# ${skill.name}\n`);
  }
  return dir;
}

describe("effectiveSkillName()", () => {
  it("should namespace a skill under its plugin", () => {
    expect(effectiveSkillName("budget", "monthly-review")).toBe("budget:monthly-review");
  });

  it("should namespace a skill that shares its plugin's name", () => {
    expect(effectiveSkillName("budget", "budget")).toBe("budget:budget");
  });
});

describe("listPluginFolders()", () => {
  it("should return an empty list when the store does not exist", () => {
    expect(listPluginFolders(join(root, "missing"))).toEqual([]);
  });

  it("should list folders holding a manifest, sorted", () => {
    writePlugin("zeta");
    writePlugin("alpha");
    expect(listPluginFolders(root)).toEqual(["alpha", "zeta"]);
  });

  it("should ignore a folder without a manifest", () => {
    writePlugin("real");
    mkdirSync(join(root, "not-a-plugin"), { recursive: true });
    expect(listPluginFolders(root)).toEqual(["real"]);
  });

  it("should ignore hidden folders", () => {
    writePlugin(".hidden");
    expect(listPluginFolders(root)).toEqual([]);
  });

  it("should ignore loose files", () => {
    writePlugin("real");
    writeFileSync(join(root, "notes.txt"), "hi");
    expect(listPluginFolders(root)).toEqual(["real"]);
  });

  it("should read as empty when the store path is a file rather than a directory", () => {
    const notADir = join(root, "plugins-file");
    writeFileSync(notADir, "not a store");
    expect(listPluginFolders(notADir)).toEqual([]);
  });
});

describe("readPluginDir()", () => {
  it("should read a manifest and namespace every skill it provides", () => {
    const dir = writePlugin("budget", {
      description: "Budget reviews.",
      skills: [
        { name: "monthly-review", description: "Reviews the month." },
        { name: "yearly-review", description: "Reviews the year." },
      ],
    });
    const plugin = readPluginDir(dir);
    expect(plugin.name).toBe("budget");
    expect(plugin.description).toBe("Budget reviews.");
    expect(plugin.error).toBeUndefined();
    expect(plugin.skills).toEqual([
      {
        rawName: "monthly-review",
        name: "budget:monthly-review",
        description: "Reviews the month.",
        dir: join(dir, "skills", "monthly-review"),
      },
      {
        rawName: "yearly-review",
        name: "budget:yearly-review",
        description: "Reviews the year.",
        dir: join(dir, "skills", "yearly-review"),
      },
    ]);
  });

  it("should take a skill's raw name from its frontmatter, not its folder", () => {
    const dir = writePlugin("budget", { skills: [{ name: "folder-name", frontmatterName: "declared-name" }] });
    expect(readPluginDir(dir).skills[0]).toMatchObject({ rawName: "declared-name", name: "budget:declared-name" });
  });

  it("should keep the optional manifest fields it was given", () => {
    const dir = join(root, "budget");
    mkdirSync(join(dir, "skills", "review"), { recursive: true });
    writeFileSync(
      join(dir, "plugin.json"),
      JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "budget",
        description: "Budget reviews.",
        version: "2.0.0",
        author: { name: "Ada" },
        repository: "https://github.com/acme/budget",
      }),
    );
    writeFileSync(join(dir, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: d\n---\n");
    const plugin = readPluginDir(dir);
    expect(plugin.version).toBe("2.0.0");
    expect(plugin.author).toEqual({ name: "Ada" });
    expect(plugin.repository).toBe("https://github.com/acme/budget");
  });

  it("should leave the repository unset when the manifest declares none", () => {
    const dir = writePlugin("budget", { skills: [{ name: "review" }] });
    expect(readPluginDir(dir).repository).toBeUndefined();
  });

  it("should surface the minimum app version a plugin declares", () => {
    const dir = writePlugin("budget", {
      manifest: JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "budget",
        description: "Budget reviews.",
        extensions: { "ai.accountant24": { minAppVersion: "9.9.9" } },
      }),
      skills: [{ name: "review" }],
    });
    expect(readPluginDir(dir).minAppVersion).toBe("9.9.9");
  });

  it("should report a missing manifest", () => {
    const dir = join(root, "empty");
    mkdirSync(dir, { recursive: true });
    expect(readPluginDir(dir).error).toBe("Could not read plugin.json.");
  });

  it("should report an invalid manifest", () => {
    const dir = writePlugin("budget", { manifest: "{oops" });
    expect(readPluginDir(dir).error).toBe("plugin.json is not valid JSON.");
  });

  it("should report a plugin with no skills, since it would do nothing", () => {
    const dir = writePlugin("budget");
    const plugin = readPluginDir(dir);
    expect(plugin.error).toBe("Plugin has no skills.");
    expect(plugin.skills).toEqual([]);
  });

  it("should drop a skill whose SKILL.md has no description", () => {
    const dir = writePlugin("budget", {
      skills: [
        { name: "good", description: "Works." },
        { name: "broken", description: "" },
      ],
    });
    expect(readPluginDir(dir).skills.map((s) => s.rawName)).toEqual(["good"]);
  });

  it("should report a plugin whose manifest omits the description", () => {
    const dir = writePlugin("budget", {
      manifest: JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "budget",
      }),
      skills: [{ name: "review" }],
    });
    expect(readPluginDir(dir).error).toBe("plugin.json: description is required.");
  });
});

describe("readPlugin()", () => {
  it("should read a plugin whose manifest name matches its folder", () => {
    writePlugin("budget", { skills: [{ name: "review" }] });
    expect(readPlugin(root, "budget").error).toBeUndefined();
  });

  it("should reject a manifest name that differs from the folder name", () => {
    writePlugin("budget", { name: "something-else", skills: [{ name: "review" }] });
    const plugin = readPlugin(root, "budget");
    expect(plugin.name).toBe("budget");
    expect(plugin.error).toBe('plugin.json: name "something-else" must match the folder name "budget".');
  });

  it("should keep the manifest error when the folder can't be read as a plugin", () => {
    writePlugin("budget", { manifest: "{oops" });
    expect(readPlugin(root, "budget").error).toBe("plugin.json is not valid JSON.");
  });
});

describe("readPlugins()", () => {
  it("should read every plugin in the store in folder order", () => {
    writePlugin("zeta", { skills: [{ name: "z" }] });
    writePlugin("alpha", { skills: [{ name: "a" }] });
    expect(readPlugins(root).map((p) => p.name)).toEqual(["alpha", "zeta"]);
  });

  it("should return an empty list for a store that does not exist", () => {
    expect(readPlugins(join(root, "missing"))).toEqual([]);
  });
});

// ---- cross-plugin resolution -------------------------------------------------

/** A plugin shaped like the store returns, without touching the filesystem. */
function plugin(name: string, skills: string[]): StoredPlugin {
  return {
    name,
    dir: `/plugins/${name}`,
    description: `${name} plugin`,
    skills: skills.map((raw) => ({
      rawName: raw,
      name: effectiveSkillName(name, raw),
      description: `${raw} skill`,
      dir: `/plugins/${name}/skills/${raw}`,
    })),
  };
}

describe("resolveSkills()", () => {
  it("should flatten every plugin's skills under its namespace", () => {
    const resolved = resolveSkills([plugin("budget", ["review"]), plugin("taxes", ["estimate"])]);
    expect(resolved.map((s) => s.name)).toEqual(["budget:review", "taxes:estimate"]);
    expect(resolved.map((s) => s.pluginName)).toEqual(["budget", "taxes"]);
    expect(resolved.every((s) => s.conflictWith === undefined)).toBe(true);
  });

  it("should mark a later plugin's skill when an earlier one already claims the raw name", () => {
    const resolved = resolveSkills([plugin("builtin", ["review"]), plugin("third-party", ["review"])]);
    expect(resolved[0].conflictWith).toBeUndefined();
    expect(resolved[1]).toMatchObject({ name: "third-party:review", conflictWith: "builtin" });
  });

  it("should let two plugins keep skills whose raw names differ", () => {
    const resolved = resolveSkills([plugin("a", ["one"]), plugin("b", ["two"])]);
    expect(resolved.filter((s) => s.conflictWith).length).toBe(0);
  });

  it("should mark every later claimant, not just the second", () => {
    const resolved = resolveSkills([plugin("a", ["dup"]), plugin("b", ["dup"]), plugin("c", ["dup"])]);
    expect(resolved.map((s) => s.conflictWith)).toEqual([undefined, "a", "a"]);
  });

  it("should return an empty list for no plugins", () => {
    expect(resolveSkills([])).toEqual([]);
  });
});

describe("hostSkills()", () => {
  it("should pair each skill folder with its namespaced name", () => {
    expect(hostSkills([plugin("budget", ["review", "forecast"])])).toEqual([
      { path: "/plugins/budget/skills/review", name: "budget:review" },
      { path: "/plugins/budget/skills/forecast", name: "budget:forecast" },
    ]);
  });

  it("should drop a skill that lost a raw-name clash, since pi would drop it anyway", () => {
    expect(hostSkills([plugin("builtin", ["review"]), plugin("third-party", ["review"])])).toEqual([
      { path: "/plugins/builtin/skills/review", name: "builtin:review" },
    ]);
  });
});

// ---- source parsing ----------------------------------------------------------

describe("parseGitHubSource()", () => {
  it("should accept the owner/repo shorthand", () => {
    expect(parseGitHubSource("owner/repo")).toEqual({ repo: "owner/repo" });
  });

  it("should accept a dot inside a name, as GitHub does", () => {
    expect(parseGitHubSource("owner/next.js")).toEqual({ repo: "owner/next.js" });
  });

  it("should reject a dot segment, which would move the API path", () => {
    expect(parseGitHubSource("../..")).toBeUndefined();
    expect(parseGitHubSource("owner/..")).toBeUndefined();
    expect(parseGitHubSource("./repo")).toBeUndefined();
  });

  it("should accept a repository URL", () => {
    expect(parseGitHubSource("https://github.com/owner/repo")).toEqual({ repo: "owner/repo" });
  });

  it("should strip a .git suffix", () => {
    expect(parseGitHubSource("https://github.com/owner/repo.git")).toEqual({ repo: "owner/repo" });
  });

  it("should strip trailing slashes", () => {
    expect(parseGitHubSource("https://github.com/owner/repo///")).toEqual({ repo: "owner/repo" });
  });

  it("should accept the www host", () => {
    expect(parseGitHubSource("https://www.github.com/owner/repo")).toEqual({ repo: "owner/repo" });
  });

  it("should read the ref out of a tree URL", () => {
    expect(parseGitHubSource("https://github.com/owner/repo/tree/main")).toEqual({ repo: "owner/repo", ref: "main" });
  });

  it("should read a subpath out of a tree URL", () => {
    expect(parseGitHubSource("https://github.com/owner/repo/tree/main/plugins/budget")).toEqual({
      repo: "owner/repo",
      ref: "main",
      subpath: "plugins/budget",
    });
  });

  it("should reject an empty input", () => {
    expect(parseGitHubSource("   ")).toBeUndefined();
  });

  it("should reject a non-GitHub host", () => {
    expect(parseGitHubSource("https://gitlab.com/owner/repo")).toBeUndefined();
  });

  it("should reject a non-http protocol", () => {
    expect(parseGitHubSource("ftp://github.com/owner/repo")).toBeUndefined();
  });

  it("should reject a URL without a repository", () => {
    expect(parseGitHubSource("https://github.com/owner")).toBeUndefined();
  });

  it("should reject a GitHub URL that is not a repo or tree URL", () => {
    expect(parseGitHubSource("https://github.com/owner/repo/blob/main/README.md")).toBeUndefined();
  });

  it("should reject a tree URL without a ref", () => {
    expect(parseGitHubSource("https://github.com/owner/repo/tree")).toBeUndefined();
  });

  it("should reject text that is neither shorthand nor a URL", () => {
    expect(parseGitHubSource("just some words")).toBeUndefined();
  });

  it("should reject shorthand with characters a repo name can't contain", () => {
    expect(parseGitHubSource("own er/repo")).toBeUndefined();
  });

  it("should reject a URL whose owner or repository carries characters GitHub does not allow", () => {
    expect(parseGitHubSource("https://github.com/own~er/repo")).toBeUndefined();
    expect(parseGitHubSource("https://github.com/owner/re~po")).toBeUndefined();
  });
});
