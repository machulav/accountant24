import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ACCOUNTANT24_HOME, LEDGER_DIR, MEMORY_PATH, setBaseDir } from "../config";

const originalHome = join(homedir(), "Accountant24");

afterEach(() => {
  setBaseDir(originalHome);
});

describe("config defaults", () => {
  test("should set ACCOUNTANT24_HOME to ~/Accountant24", () => {
    setBaseDir(originalHome);
    expect(ACCOUNTANT24_HOME).toBe(join(homedir(), "Accountant24"));
  });

  test("should set MEMORY_PATH to ~/Accountant24/memory.md", () => {
    setBaseDir(originalHome);
    expect(MEMORY_PATH).toBe(join(homedir(), "Accountant24", "memory.md"));
  });

  test("should set LEDGER_DIR to ~/Accountant24/ledger", () => {
    setBaseDir(originalHome);
    expect(LEDGER_DIR).toBe(join(homedir(), "Accountant24", "ledger"));
  });
});

describe("ACCOUNTANT24_HOME env var (module eval)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("should use ACCOUNTANT24_HOME when set and non-empty", async () => {
    vi.stubEnv("ACCOUNTANT24_HOME", "/tmp/env-home");
    vi.resetModules();
    const config = await import("../config.js");
    expect(config.ACCOUNTANT24_HOME).toBe("/tmp/env-home");
    expect(config.MEMORY_PATH).toBe(join("/tmp/env-home", "memory.md"));
    expect(config.LEDGER_DIR).toBe(join("/tmp/env-home", "ledger"));
  });

  test("should fall back to ~/Accountant24 when ACCOUNTANT24_HOME is empty", async () => {
    vi.stubEnv("ACCOUNTANT24_HOME", "");
    vi.resetModules();
    const config = await import("../config.js");
    expect(config.ACCOUNTANT24_HOME).toBe(join(homedir(), "Accountant24"));
  });
});

describe("setBaseDir()", () => {
  test("should update ACCOUNTANT24_HOME to given dir", () => {
    setBaseDir("/tmp/test-dir");
    expect(ACCOUNTANT24_HOME).toBe("/tmp/test-dir");
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
