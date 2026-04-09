import { afterEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
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
