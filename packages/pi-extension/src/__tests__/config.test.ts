import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ACCOUNTANT24_WORKSPACE, LEDGER_DIR, MEMORY_PATH, setBaseDir } from "../config";

const originalHome = join(homedir(), ".accountant24");

afterEach(() => {
  setBaseDir(originalHome);
});

describe("config defaults", () => {
  test("should set ACCOUNTANT24_WORKSPACE to ~/.accountant24", () => {
    setBaseDir(originalHome);
    expect(ACCOUNTANT24_WORKSPACE).toBe(join(homedir(), ".accountant24"));
  });

  test("should set MEMORY_PATH to ~/.accountant24/memory.md", () => {
    setBaseDir(originalHome);
    expect(MEMORY_PATH).toBe(join(homedir(), ".accountant24", "memory.md"));
  });

  test("should set LEDGER_DIR to ~/.accountant24/ledger", () => {
    setBaseDir(originalHome);
    expect(LEDGER_DIR).toBe(join(homedir(), ".accountant24", "ledger"));
  });
});

describe("ACCOUNTANT24_WORKSPACE env var (module eval)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("should use ACCOUNTANT24_WORKSPACE when set and non-empty", async () => {
    vi.stubEnv("ACCOUNTANT24_WORKSPACE", "/tmp/env-home");
    vi.resetModules();
    const config = await import("../config.js");
    expect(config.ACCOUNTANT24_WORKSPACE).toBe("/tmp/env-home");
    expect(config.MEMORY_PATH).toBe(join("/tmp/env-home", "memory.md"));
    expect(config.LEDGER_DIR).toBe(join("/tmp/env-home", "ledger"));
  });

  test("should fall back to ~/.accountant24 when ACCOUNTANT24_WORKSPACE is empty", async () => {
    vi.stubEnv("ACCOUNTANT24_WORKSPACE", "");
    vi.resetModules();
    const config = await import("../config.js");
    expect(config.ACCOUNTANT24_WORKSPACE).toBe(join(homedir(), ".accountant24"));
  });
});

describe("setBaseDir()", () => {
  test("should update ACCOUNTANT24_WORKSPACE to given dir", () => {
    setBaseDir("/tmp/test-dir");
    expect(ACCOUNTANT24_WORKSPACE).toBe("/tmp/test-dir");
  });

  test("should update MEMORY_PATH to dir/memory.md", () => {
    setBaseDir("/tmp/test-dir");
    expect(MEMORY_PATH).toBe("/tmp/test-dir/memory.md");
  });

  test("should update LEDGER_DIR to dir/ledger", () => {
    setBaseDir("/tmp/test-dir");
    expect(LEDGER_DIR).toBe("/tmp/test-dir/ledger");
  });
});
