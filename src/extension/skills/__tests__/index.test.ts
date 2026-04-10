import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { loadSkillsFromDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { getBuiltinSkillsDir } from "../index.js";

describe("getBuiltinSkillsDir()", () => {
  test("should return an absolute path to an existing directory", () => {
    const dir = getBuiltinSkillsDir();
    expect(dir.startsWith("/")).toBe(true);
    expect(existsSync(dir)).toBe(true);
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  test("should contain a hledger subdirectory with SKILL.md", () => {
    const dir = getBuiltinSkillsDir();
    const hledgerDir = join(dir, "hledger");
    const skillFile = join(hledgerDir, "SKILL.md");
    expect(statSync(hledgerDir).isDirectory()).toBe(true);
    expect(existsSync(skillFile)).toBe(true);
  });
});

describe("hledger SKILL.md frontmatter", () => {
  const skillFile = join(getBuiltinSkillsDir(), "hledger", "SKILL.md");
  const { frontmatter, body } = parseFrontmatter<{ name?: string; description?: string }>(
    readFileSync(skillFile, "utf-8"),
  );

  test("should declare name 'hledger'", () => {
    expect(frontmatter.name).toBe("hledger");
  });

  test("should match the parent directory name", () => {
    const parentDir = basename(join(skillFile, ".."));
    expect(frontmatter.name).toBe(parentDir);
  });

  test("should declare a non-empty description within 1024 chars", () => {
    expect(typeof frontmatter.description).toBe("string");
    expect((frontmatter.description ?? "").length).toBeGreaterThan(0);
    expect((frontmatter.description ?? "").length).toBeLessThanOrEqual(1024);
  });

  test("should have a non-empty body", () => {
    expect(body.trim().length).toBeGreaterThan(0);
  });
});

describe("loadSkillsFromDir(getBuiltinSkillsDir())", () => {
  const result = loadSkillsFromDir({ dir: getBuiltinSkillsDir(), source: "test" });

  test("should load exactly one built-in skill", () => {
    expect(result.skills).toHaveLength(1);
  });

  test("should load the hledger skill", () => {
    expect(result.skills[0]?.name).toBe("hledger");
  });

  test("should expose the hledger description to the loader", () => {
    expect(result.skills[0]?.description.length).toBeGreaterThan(0);
  });

  test("should not be model-invocation-disabled", () => {
    expect(result.skills[0]?.disableModelInvocation).toBe(false);
  });

  test("should load without error-level diagnostics", () => {
    const errors = result.diagnostics.filter((d) => d.type === "error");
    expect(errors).toEqual([]);
  });
});
