import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTmpWorkspace } from "./tmpWorkspace";

// files.ts archives renderer-supplied bytes (base64) into the workspace under
// files/YYYY/MM with a timestamped name, and returns the workspace-relative
// path. Electron IPC is the only faked boundary; the fs is real (a temp
// ACCOUNTANT24_HOME via makeTmpWorkspace) so the round-trip is honest.
type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
}));

const ws = makeTmpWorkspace();

async function setup() {
  const mod = await import("../files");
  mod.registerFilesIpc();
  return mod;
}

/** Invoke the archive handler and return the workspace-relative path it yields. */
const archive = (payload: unknown): string => {
  const handler = h.handlers.get("files_archive_to_workspace");
  if (!handler) throw new Error("no handler for files_archive_to_workspace");
  return handler(null, payload) as string;
};

/** base64 of a UTF-8 string. */
const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

beforeEach(() => {
  h.handlers.clear();
  ws.setup();
  vi.resetModules();
});

afterEach(() => {
  ws.cleanup();
  vi.useRealTimers();
});

describe("files_archive_to_workspace", () => {
  it("should write the decoded bytes under files/YYYY/MM and return the stored copy's relative path", async () => {
    await setup();
    const rel = archive({ name: "receipt.pdf", dataBase64: b64("hello world") });

    // Shape: files/<4-digit year>/<2-digit month>/<14-digit timestamp>.pdf
    expect(rel).toMatch(/^files\/\d{4}\/\d{2}\/\d{14}\.pdf$/);

    const absolute = ws.path(rel);
    expect(existsSync(absolute)).toBe(true);
    expect(readFileSync(absolute).toString("utf8")).toBe("hello world");
  });

  it("should return a workspace-relative path, never an absolute one", async () => {
    await setup();
    const rel = archive({ name: "a.png", dataBase64: b64("x") });
    expect(path.isAbsolute(rel)).toBe(false);
    expect(rel.startsWith("files/")).toBe(true);
  });

  it("should preserve the original file's extension in the stored name", async () => {
    await setup();
    const rel = archive({ name: "statement.csv", dataBase64: b64("a,b\n1,2") });
    expect(rel).toMatch(/\.csv$/);
    expect(path.basename(rel)).toMatch(/^\d{14}\.csv$/);
  });

  it("should store a name with no extension when the original has none", async () => {
    await setup();
    const rel = archive({ name: "Makefile", dataBase64: b64("all:") });
    expect(path.basename(rel)).toMatch(/^\d{14}$/);
    expect(existsSync(ws.path(rel))).toBe(true);
  });

  it("should create the month directory when it does not exist yet", async () => {
    await setup();
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const monthDir = ws.path("files", year, month);

    expect(existsSync(monthDir)).toBe(false);
    archive({ name: "a.txt", dataBase64: b64("hi") });
    expect(existsSync(monthDir)).toBe(true);
  });

  it("should discard the original name and use only its extension, so a traversal name cannot escape files/YYYY/MM", async () => {
    await setup();
    const rel = archive({ name: "../../../../etc/passwd.pdf", dataBase64: b64("nope") });
    // Only the extension survives; the name itself is replaced by the timestamp.
    expect(rel).toMatch(/^files\/\d{4}\/\d{2}\/\d{14}\.pdf$/);
    expect(rel).not.toContain("..");
    expect(rel).not.toContain("passwd");
  });

  it("should deduplicate a collision within the same second by suffixing -2", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00"));
    await setup();

    const first = archive({ name: "a.pdf", dataBase64: b64("one") });
    const second = archive({ name: "a.pdf", dataBase64: b64("two") });

    expect(path.basename(first)).toBe("20260711120000.pdf");
    expect(path.basename(second)).toBe("20260711120000-2.pdf");

    // Both survive on disk with their own bytes — the second did not clobber the first.
    expect(readFileSync(ws.path(first)).toString("utf8")).toBe("one");
    expect(readFileSync(ws.path(second)).toString("utf8")).toBe("two");
  });

  it("should write a zero-byte file when given empty base64 input", async () => {
    await setup();
    const rel = archive({ name: "empty.bin", dataBase64: "" });
    const absolute = ws.path(rel);
    expect(existsSync(absolute)).toBe(true);
    expect(readFileSync(absolute).length).toBe(0);
  });

  it("should throw when the payload is missing", async () => {
    await setup();
    expect(() => archive(undefined)).toThrow();
  });
});
