import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// skills.ts adds skills from GitHub tarballs into the workspace skills store. The
// network (fetch) and Electron are the faked I/O boundaries; the pipeline —
// tar extraction, pi's skill loader/validation, the store folders, manifest,
// and registry persistence — runs for real over a temp workspace.
type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sendToWindow: vi.fn(),
  ws: "",
  skillAdded: vi.fn(),
  skillAddFailed: vi.fn(),
  skillRemoved: vi.fn(),
  skillEnabled: vi.fn(),
  skillDisabled: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
}));
vi.mock("../analytics", () => ({
  trackSkillAdded: h.skillAdded,
  trackSkillAddFailed: h.skillAddFailed,
  trackSkillRemoved: h.skillRemoved,
  trackSkillEnabled: h.skillEnabled,
  trackSkillDisabled: h.skillDisabled,
}));
vi.mock("../env", () => ({
  workspaceDir: () => h.ws,
  skillsDir: () => join(h.ws, "skills"),
  // Stands in for the app bundle's resources/skills — per-test fixtures.
  nativeSkillsDir: () => join(h.ws, "native-skills"),
}));

const win = { isDestroyed: () => false, webContents: { send: h.sendToWindow } };

const invoke = (channel: string, payload?: unknown) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, payload);
};

/** Drop a native skill into the fixture bundle dir. */
function addNativeSkill(name: string, description = "Native capability."): void {
  const dir = join(h.ws, "native-skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`);
}

// ---- fixture tarball ---------------------------------------------------------
// Simulates a GitHub tarball: one wrapper dir (owner-repo-sha/) holding a repo
// with two valid skills, one invalid skill (no description), and a stray file.

let fixtureTarball: Buffer;

async function buildFixtureTarball(): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "a24-skills-fixture-"));
  try {
    const repo = join(dir, "owner-repo-0123abc");
    const write = (rel: string, content: string) => {
      mkdirSync(join(repo, rel, ".."), { recursive: true });
      writeFileSync(join(repo, rel), content);
    };
    mkdirSync(join(repo, "skills", "pdf"), { recursive: true });
    mkdirSync(join(repo, "skills", "web-search"), { recursive: true });
    mkdirSync(join(repo, "skills", "broken"), { recursive: true });
    write(join("skills", "pdf", "SKILL.md"), "---\nname: pdf\ndescription: Work with PDF files.\n---\n# PDF\n");
    write(join("skills", "pdf", "reference.md"), "extra asset\n");
    write(
      join("skills", "web-search", "SKILL.md"),
      "---\nname: web-search\ndescription: Search the web.\n---\n# Web\n",
    );
    write(join("skills", "broken", "SKILL.md"), "---\nname: broken\n---\nno description\n");
    write("README.md", "# repo\n");

    const file = join(dir, "fixture.tgz");
    await tar.c({ gzip: true, file, cwd: dir }, ["owner-repo-0123abc"]);
    return readFileSync(file);
  } finally {
    // The tarball bytes are in memory; the staging dir can go.
    setTimeout(() => rmSync(dir, { recursive: true, force: true }), 0);
  }
}

/** fetch stub serving the fixture tarball for any URL. */
function stubFetchWithTarball(bytes: Buffer): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

// ---- setup -------------------------------------------------------------------

beforeEach(async () => {
  h.handlers.clear();
  h.skillAdded.mockClear();
  h.skillAddFailed.mockClear();
  h.skillRemoved.mockClear();
  h.skillEnabled.mockClear();
  h.skillDisabled.mockClear();
  h.ws = mkdtempSync(join(tmpdir(), "a24-skills-ws-"));
  fixtureTarball ??= await buildFixtureTarball();
  vi.resetModules();
  const mod = await import("../skills");
  mod.registerSkillsIpc(() => win as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(h.ws, { recursive: true, force: true });
});

// ---- skills_list -------------------------------------------------------------

describe("skills_list", () => {
  it("should return an empty list for a fresh workspace with no native skills", () => {
    const result = invoke("skills_list") as { skills: unknown[] };
    expect(result.skills).toEqual([]);
  });

  it("should list native skills first, always enabled and flagged native", () => {
    addNativeSkill("subscription-audit", "Find recurring charges.");
    const dir = join(h.ws, "skills", "extra");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: extra\ndescription: Third-party.\n---\n");

    const result = invoke("skills_list") as { skills: Record<string, unknown>[] };
    expect(result.skills).toEqual([
      { name: "subscription-audit", description: "Find recurring charges.", enabled: true, native: true },
      // Hand-dropped folders are not on the allowlist until toggled on.
      { name: "extra", description: "Third-party.", enabled: false },
    ]);
  });

  it("should list a manually dropped skill folder without a source, off until approved", () => {
    const dir = join(h.ws, "skills", "my-manual");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: my-manual\ndescription: Hand-made.\n---\n");

    const result = invoke("skills_list") as { skills: Record<string, unknown>[] };
    expect(result.skills).toEqual([{ name: "my-manual", description: "Hand-made.", enabled: false }]);

    invoke("skills_set_enabled", { name: "my-manual", enabled: true });
    const after = invoke("skills_list") as { skills: Record<string, unknown>[] };
    expect(after.skills[0].enabled).toBe(true);
  });

  it("should surface a folder whose SKILL.md lacks a description as an error row", () => {
    const dir = join(h.ws, "skills", "bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: bad\n---\n");

    const result = invoke("skills_list") as { skills: { name: string; error?: string }[] };
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("bad");
    expect(result.skills[0].error).toContain("missing a description");
  });
});

// ---- skills_add ----------------------------------------------------------

describe("skills_add", () => {
  it("should add every valid skill from the tarball and record provenance", async () => {
    const fetchMock = stubFetchWithTarball(fixtureTarball);

    const result = (await invoke("skills_add", { source: "owner/repo" })) as {
      type: string;
      added: string[];
    };
    expect(result.type).toBe("done");
    expect(result.added.sort()).toEqual(["pdf", "web-search"]);

    // Store folders are real, self-contained copies.
    expect(existsSync(join(h.ws, "skills", "pdf", "SKILL.md"))).toBe(true);
    expect(existsSync(join(h.ws, "skills", "pdf", "reference.md"))).toBe(true);
    expect(existsSync(join(h.ws, "skills", "web-search", "SKILL.md"))).toBe(true);
    // The invalid skill is not added.
    expect(existsSync(join(h.ws, "skills", "broken"))).toBe(false);

    // The registry entry: approval + provenance + the tarball's commit SHA.
    const registry = JSON.parse(readFileSync(join(h.ws, "skills", ".skills.json"), "utf8"));
    expect(registry.pdf.enabled).toBe(true);
    expect(registry.pdf.source).toBe("owner/repo");
    expect(registry.pdf.subpath).toBe("skills/pdf");
    expect(registry.pdf.commit).toBe("0123abc");
    expect(typeof registry.pdf.addedAt).toBe("string");

    // The tarball was fetched from the GitHub API for that repo.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/tarball",
      expect.objectContaining({ headers: expect.objectContaining({ "User-Agent": expect.any(String) }) }),
    );
  });

  it("should include the ref in the tarball URL and the manifest", async () => {
    stubFetchWithTarball(fixtureTarball);
    await invoke("skills_add", { source: "owner/repo", ref: "abc123" });

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/tarball/abc123",
      expect.anything(),
    );
    const registry = JSON.parse(readFileSync(join(h.ws, "skills", ".skills.json"), "utf8"));
    expect(registry.pdf.ref).toBe("abc123");
  });

  it("should install only the skill under a given subpath", async () => {
    stubFetchWithTarball(fixtureTarball);

    const result = (await invoke("skills_add", { source: "owner/repo", subpath: "skills/pdf" })) as {
      type: string;
      added: string[];
    };
    expect(result.added).toEqual(["pdf"]);
    expect(existsSync(join(h.ws, "skills", "web-search"))).toBe(false);
  });

  it("should install only the requested skill names when a filter is given", async () => {
    stubFetchWithTarball(fixtureTarball);

    const result = (await invoke("skills_add", { source: "owner/repo", skills: ["web-search"] })) as {
      type: string;
      added: string[];
    };
    expect(result.added).toEqual(["web-search"]);
    expect(existsSync(join(h.ws, "skills", "pdf"))).toBe(false);
  });

  it("should parse a github tree URL into repo, ref, and subpath", async () => {
    stubFetchWithTarball(fixtureTarball);

    const result = (await invoke("skills_add", {
      source: "https://github.com/owner/repo/tree/main/skills/pdf",
    })) as { type: string; added: string[] };
    expect(result.added).toEqual(["pdf"]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/tarball/main",
      expect.anything(),
    );
  });

  it("should reject input that is not a GitHub repo", async () => {
    const result = (await invoke("skills_add", { source: "https://gitlab.com/x/y" })) as { type: string };
    expect(result.type).toBe("error");
  });

  it("should report a friendly error for an unknown repo (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const result = (await invoke("skills_add", { source: "owner/ghost" })) as { type: string; message: string };
    expect(result.type).toBe("error");
    expect(result.message).toContain("not found");
  });

  it("should report the rate-limit case (403) distinctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("limited", { status: 403 })),
    );
    const result = (await invoke("skills_add", { source: "owner/repo" })) as { type: string; message: string };
    expect(result.type).toBe("error");
    expect(result.message).toContain("rate limit");
  });

  it("should error when the repo contains no skills", async () => {
    stubFetchWithTarball(fixtureTarball);
    const result = (await invoke("skills_add", { source: "owner/repo", subpath: "skills/broken" })) as {
      type: string;
      message: string;
    };
    expect(result.type).toBe("error");
    expect(result.message).toContain("No skills");
  });

  it("should reject a subpath escaping the extracted tree", async () => {
    stubFetchWithTarball(fixtureTarball);
    const result = (await invoke("skills_add", { source: "owner/repo", subpath: "../../etc" })) as {
      type: string;
    };
    expect(result.type).toBe("error");
  });

  it("should never clobber an existing skill that came from elsewhere", async () => {
    // A manual skill named "pdf" already sits in the store (no manifest entry).
    const dir = join(h.ws, "skills", "pdf");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: pdf\ndescription: Mine.\n---\n");

    stubFetchWithTarball(fixtureTarball);
    const result = (await invoke("skills_add", { source: "owner/repo" })) as {
      type: string;
      added: string[];
      skipped: { name: string }[];
    };
    // web-search installs; pdf is skipped and untouched.
    expect(result.type).toBe("done");
    expect(result.added).toEqual(["web-search"]);
    expect(result.skipped.map((s) => s.name)).toEqual(["pdf"]);
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("Mine.");
  });

  it("should overwrite on re-install from the same repo (that is an update)", async () => {
    stubFetchWithTarball(fixtureTarball);
    await invoke("skills_add", { source: "owner/repo" });
    const marker = join(h.ws, "skills", "pdf", "stale-file.txt");
    writeFileSync(marker, "left over from the previous version");

    const result = (await invoke("skills_add", { source: "owner/repo" })) as { type: string; added: string[] };
    expect(result.type).toBe("done");
    expect(result.added).toContain("pdf");
    expect(existsSync(marker)).toBe(false);
  });

  it("should stream progress events to the renderer", async () => {
    stubFetchWithTarball(fixtureTarball);
    await invoke("skills_add", { source: "owner/repo" });

    const events = h.sendToWindow.mock.calls.filter((c) => c[0] === "skills-event").map((c) => c[1]);
    expect(events.some((e: { message: string }) => e.message.includes("Downloading"))).toBe(true);
    expect(events.some((e: { message: string }) => e.message.includes("Adding"))).toBe(true);
  });

  it("should skip a fetched skill whose name is built into the app", async () => {
    addNativeSkill("pdf", "Native pdf handling.");
    stubFetchWithTarball(fixtureTarball);

    const result = (await invoke("skills_add", { source: "owner/repo" })) as {
      type: string;
      added: string[];
      skipped: { name: string; message: string }[];
    };
    expect(result.type).toBe("done");
    expect(result.added).toEqual(["web-search"]);
    expect(result.skipped).toEqual([{ name: "pdf", message: "A skill with this name is built into the app." }]);
    expect(existsSync(join(h.ws, "skills", "pdf"))).toBe(false);
  });
});

// ---- analytics -----------------------------------------------------------------

describe("skills analytics", () => {
  it("should track skill_added with counts, a native collision counting as skipped", async () => {
    addNativeSkill("pdf", "Native pdf handling.");
    stubFetchWithTarball(fixtureTarball);

    await invoke("skills_add", { source: "owner/repo" });

    expect(h.skillAdded).toHaveBeenCalledWith(1, 1); // web-search added, pdf skipped
    expect(h.skillAddFailed).not.toHaveBeenCalled();
  });

  it("should track a structural reason for each failed add", async () => {
    await invoke("skills_add", { source: "https://gitlab.com/x/y" });
    expect(h.skillAddFailed).toHaveBeenLastCalledWith("invalid_source");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await invoke("skills_add", { source: "owner/ghost" });
    expect(h.skillAddFailed).toHaveBeenLastCalledWith("not_found");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("limited", { status: 403 })),
    );
    await invoke("skills_add", { source: "owner/repo" });
    expect(h.skillAddFailed).toHaveBeenLastCalledWith("fetch_failed");

    stubFetchWithTarball(fixtureTarball);
    await invoke("skills_add", { source: "owner/repo", subpath: "skills/broken" });
    expect(h.skillAddFailed).toHaveBeenLastCalledWith("no_skills");

    expect(h.skillAdded).not.toHaveBeenCalled();
  });

  it("should track a thrown network error as fetch_failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    );
    await invoke("skills_add", { source: "owner/repo" });
    expect(h.skillAddFailed).toHaveBeenLastCalledWith("fetch_failed");
  });

  it("should track an install where everything was skipped as reason other", async () => {
    // Both fixture skills already sit in the store as manual drops.
    for (const name of ["pdf", "web-search"]) {
      const dir = join(h.ws, "skills", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Mine.\n---\n`);
    }
    stubFetchWithTarball(fixtureTarball);

    await invoke("skills_add", { source: "owner/repo" });

    expect(h.skillAddFailed).toHaveBeenLastCalledWith("other");
    expect(h.skillAdded).not.toHaveBeenCalled();
  });

  it("should track remove on success and stay silent on the native guard", async () => {
    stubFetchWithTarball(fixtureTarball);
    await invoke("skills_add", { source: "owner/repo" });

    invoke("skills_remove", { name: "pdf" });
    expect(h.skillRemoved).toHaveBeenCalledTimes(1);

    addNativeSkill("core");
    invoke("skills_remove", { name: "core" });
    expect(h.skillRemoved).toHaveBeenCalledTimes(1);
  });

  it("should track enable and disable separately and stay silent on the native guard", async () => {
    stubFetchWithTarball(fixtureTarball);
    await invoke("skills_add", { source: "owner/repo" });

    invoke("skills_set_enabled", { name: "pdf", enabled: false });
    expect(h.skillDisabled).toHaveBeenCalledTimes(1);
    expect(h.skillEnabled).not.toHaveBeenCalled();

    invoke("skills_set_enabled", { name: "pdf", enabled: true });
    expect(h.skillEnabled).toHaveBeenCalledTimes(1);

    addNativeSkill("core");
    invoke("skills_set_enabled", { name: "core", enabled: false });
    expect(h.skillDisabled).toHaveBeenCalledTimes(1);
  });
});

// ---- skills_set_enabled --------------------------------------------------------

describe("skills_set_enabled", () => {
  it("should approve added skills in the registry, then disable and re-enable one", async () => {
    stubFetchWithTarball(fixtureTarball);
    await invoke("skills_add", { source: "owner/repo" });

    // The install itself wrote enabled entries.
    const registry = () => JSON.parse(readFileSync(join(h.ws, "skills", ".skills.json"), "utf8"));
    expect(registry().pdf.enabled).toBe(true);
    expect(registry()["web-search"].enabled).toBe(true);

    invoke("skills_set_enabled", { name: "pdf", enabled: false });
    let list = invoke("skills_list") as { skills: { name: string; enabled: boolean }[] };
    expect(list.skills.find((s) => s.name === "pdf")?.enabled).toBe(false);
    expect(list.skills.find((s) => s.name === "web-search")?.enabled).toBe(true);

    // Disabling flips the flag but keeps the provenance.
    expect(registry().pdf).toMatchObject({ enabled: false, source: "owner/repo" });

    invoke("skills_set_enabled", { name: "pdf", enabled: true });
    list = invoke("skills_list") as { skills: { name: string; enabled: boolean }[] };
    expect(list.skills.find((s) => s.name === "pdf")?.enabled).toBe(true);
  });

  it("should refuse to disable a built-in skill", () => {
    addNativeSkill("subscription-audit");
    const result = invoke("skills_set_enabled", { name: "subscription-audit", enabled: false }) as {
      type: string;
      message: string;
    };
    expect(result.type).toBe("error");
    expect(result.message).toContain("built-in");
    const list = invoke("skills_list") as { skills: { name: string; enabled: boolean }[] };
    expect(list.skills.find((s) => s.name === "subscription-audit")?.enabled).toBe(true);
  });
});

// ---- skills_remove -------------------------------------------------------------

describe("skills_remove", () => {
  it("should delete the folder and its registry entry together", async () => {
    stubFetchWithTarball(fixtureTarball);
    await invoke("skills_add", { source: "owner/repo" });

    const result = invoke("skills_remove", { name: "pdf" }) as { type: string };
    expect(result.type).toBe("done");
    expect(existsSync(join(h.ws, "skills", "pdf"))).toBe(false);

    const registry = JSON.parse(readFileSync(join(h.ws, "skills", ".skills.json"), "utf8"));
    expect(registry.pdf).toBeUndefined();
    expect(registry["web-search"]).toMatchObject({ enabled: true });
  });

  it("should reject names that could escape the store", () => {
    for (const name of ["../ledger", "a/b", "..", ".skills.json", ""]) {
      const result = invoke("skills_remove", { name }) as { type: string };
      expect(result.type, `name: ${name}`).toBe("error");
    }
  });

  it("should refuse to remove a built-in skill", () => {
    addNativeSkill("subscription-audit");
    const result = invoke("skills_remove", { name: "subscription-audit" }) as { type: string; message: string };
    expect(result.type).toBe("error");
    expect(result.message).toContain("built-in");
    expect(existsSync(join(h.ws, "native-skills", "subscription-audit"))).toBe(true);
  });
});

// ---- native content -------------------------------------------------------------

describe("shipped native skills content", () => {
  it("should parse cleanly with pi's loader: valid frontmatter, name == folder, description present", () => {
    // The REAL committed content, not a fixture — guards typos in authored skills.
    const shipped = fileURLToPath(new URL("../../../resources/skills", import.meta.url));
    const { skills, diagnostics } = loadSkillsFromDir({ dir: shipped, source: "native" });
    expect(diagnostics).toEqual([]);
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.name).toBe(basename(skill.baseDir));
      expect(skill.description.trim().length).toBeGreaterThan(0);
      expect(skill.description.length).toBeLessThanOrEqual(1024);
    }
  });
});
