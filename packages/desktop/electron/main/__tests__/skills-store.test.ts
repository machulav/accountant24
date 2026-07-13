import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSkillArgs,
  listSkillFolders,
  parseGitHubSource,
  readRegistry,
  sanitizeSkillFolderName,
  writeRegistry,
} from "../skills-store";

// The store is plain folders on disk — tests use a real temp dir (fs is the I/O
// boundary the module exists to wrap; mocking it would test nothing).

let root: string;

function addSkill(name: string): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "a24-skills-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("listSkillFolders()", () => {
  it("should return an empty list when the store directory does not exist", () => {
    expect(listSkillFolders(join(root, "missing"))).toEqual([]);
  });

  it("should return an empty list for an empty store", () => {
    expect(listSkillFolders(root)).toEqual([]);
  });

  it("should list only directories that contain a SKILL.md, sorted by name", () => {
    addSkill("pdf");
    addSkill("docx");
    mkdirSync(join(root, "not-a-skill"));
    writeFileSync(join(root, "stray-file.md"), "not a skill dir");

    expect(listSkillFolders(root)).toEqual(["docx", "pdf"]);
  });

  it("should ignore hidden directories even when they contain a SKILL.md", () => {
    addSkill(".disabled-stash");
    addSkill("pdf");
    writeFileSync(join(root, ".skills.json"), "{}");

    expect(listSkillFolders(root)).toEqual(["pdf"]);
  });
});

/** Write registry entries for the given folders (enabled unless stated). */
function setRegistry(entries: Record<string, { enabled: boolean }>): void {
  writeFileSync(join(root, ".skills.json"), JSON.stringify(entries));
}

describe("buildSkillArgs()", () => {
  it("should emit a --skill flag per enabled registry entry", () => {
    addSkill("docx");
    addSkill("pdf");
    setRegistry({ docx: { enabled: true }, pdf: { enabled: true } });

    expect(buildSkillArgs(root)).toEqual(["--skill", join(root, "docx"), "--skill", join(root, "pdf")]);
  });

  it("should omit folders whose entry is disabled or missing", () => {
    addSkill("docx");
    addSkill("pdf");
    addSkill("web-search");
    setRegistry({ docx: { enabled: true }, pdf: { enabled: false } });

    expect(buildSkillArgs(root)).toEqual(["--skill", join(root, "docx")]);
  });

  it("should return no args without a registry (a hand-dropped folder stays off)", () => {
    addSkill("pdf");
    expect(buildSkillArgs(root)).toEqual([]);
  });

  it("should ignore enabled entries whose folder is not installed", () => {
    addSkill("pdf");
    setRegistry({ pdf: { enabled: true }, ghost: { enabled: true } });
    expect(buildSkillArgs(root)).toEqual(["--skill", join(root, "pdf")]);
  });

  it("should return no args when the store directory does not exist", () => {
    expect(buildSkillArgs(join(root, "missing"))).toEqual([]);
  });
});

describe("readRegistry() / writeRegistry()", () => {
  it("should return an empty manifest when none exists", () => {
    expect(readRegistry(root)).toEqual({});
  });

  it("should round-trip registry entries", () => {
    addSkill("pdf");
    const manifest = {
      pdf: {
        enabled: true,
        source: "anthropics/skills",
        subpath: "skills/pdf",
        ref: "abc123",
        commit: "0123abc",
        addedAt: "2026-07-12T00:00:00Z",
      },
    };
    writeRegistry(root, manifest);
    expect(readRegistry(root)).toEqual(manifest);
  });

  it("should prune entries whose folder no longer exists when writing", () => {
    addSkill("pdf");
    writeRegistry(root, { pdf: { enabled: true }, ghost: { enabled: true } });
    expect(readRegistry(root)).toEqual({ pdf: { enabled: true } });
  });

  it("should store the manifest as a hidden file so it is never listed as a skill", () => {
    writeRegistry(root, {});
    expect(readFileSync(join(root, ".skills.json"), "utf8")).toBe("{}\n");
    expect(listSkillFolders(root)).toEqual([]);
  });

  it("should return an empty manifest for a corrupt file instead of throwing", () => {
    writeFileSync(join(root, ".skills.json"), "{not json");
    expect(readRegistry(root)).toEqual({});
  });

  it("should return an empty manifest when the file holds a non-object", () => {
    writeFileSync(join(root, ".skills.json"), '"just a string"');
    expect(readRegistry(root)).toEqual({});
  });
});

describe("sanitizeSkillFolderName()", () => {
  it("should keep a spec-compliant name unchanged", () => {
    expect(sanitizeSkillFolderName("pdf-tools-2")).toBe("pdf-tools-2");
  });

  it("should lowercase and replace invalid characters with hyphens", () => {
    expect(sanitizeSkillFolderName("My PDF Skill!")).toBe("my-pdf-skill");
  });

  it("should collapse consecutive hyphens and trim leading/trailing ones", () => {
    expect(sanitizeSkillFolderName("--a__b--")).toBe("a-b");
  });

  it("should neutralize path traversal attempts", () => {
    expect(sanitizeSkillFolderName("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeSkillFolderName("a/b\\c")).toBe("a-b-c");
  });

  it("should cap the name at 64 characters", () => {
    const name = sanitizeSkillFolderName(`${"x".repeat(70)}`);
    expect(name).toHaveLength(64);
  });

  it("should return undefined when nothing usable remains", () => {
    expect(sanitizeSkillFolderName("!!!")).toBeUndefined();
    expect(sanitizeSkillFolderName("")).toBeUndefined();
  });
});

describe("parseGitHubSource()", () => {
  it("should accept a bare owner/repo shorthand", () => {
    expect(parseGitHubSource("anthropics/skills")).toEqual({ repo: "anthropics/skills" });
  });

  it("should accept a plain repo URL, with or without .git and trailing slash", () => {
    expect(parseGitHubSource("https://github.com/badlogic/pi-skills")).toEqual({ repo: "badlogic/pi-skills" });
    expect(parseGitHubSource("https://github.com/badlogic/pi-skills.git")).toEqual({ repo: "badlogic/pi-skills" });
    expect(parseGitHubSource("https://github.com/badlogic/pi-skills/")).toEqual({ repo: "badlogic/pi-skills" });
    expect(parseGitHubSource("https://www.github.com/badlogic/pi-skills")).toEqual({ repo: "badlogic/pi-skills" });
  });

  it("should extract ref and subpath from a tree URL", () => {
    expect(parseGitHubSource("https://github.com/anthropics/skills/tree/main/skills/pdf")).toEqual({
      repo: "anthropics/skills",
      ref: "main",
      subpath: "skills/pdf",
    });
  });

  it("should extract a ref-only tree URL", () => {
    expect(parseGitHubSource("https://github.com/anthropics/skills/tree/v1.2")).toEqual({
      repo: "anthropics/skills",
      ref: "v1.2",
    });
  });

  it("should reject other hosts and malformed input", () => {
    expect(parseGitHubSource("https://gitlab.com/foo/bar")).toBeUndefined();
    expect(parseGitHubSource("https://github.com/only-owner")).toBeUndefined();
    expect(parseGitHubSource("https://github.com/foo/bar/blob/main/x.md")).toBeUndefined();
    expect(parseGitHubSource("not a url at all")).toBeUndefined();
    expect(parseGitHubSource("")).toBeUndefined();
    expect(parseGitHubSource("ftp://github.com/foo/bar")).toBeUndefined();
  });
});
