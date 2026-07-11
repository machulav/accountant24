// Isolated temp ACCOUNTANT24_HOME for main-process integration tests.
//
// The main modules (settings.ts, files.ts, ledger.ts, analytics.ts, …) resolve
// their storage under `workspaceDir()`, which reads process.env.ACCOUNTANT24_HOME
// (see ../env.ts). Pointing that at a fresh temp dir lets these tests do REAL fs
// round-trips — the honest I/O boundary — instead of mocking node:fs globally.
//
//   const ws = makeTmpWorkspace();
//   beforeEach(() => ws.setup());
//   afterEach(() => ws.cleanup());
//   // ws.dir is the temp workspace; ws.path("ledger", "main.journal") joins into it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface TmpWorkspace {
  /** The active temp workspace dir (valid between setup() and cleanup()). */
  readonly dir: string;
  /** Create a fresh temp dir and point ACCOUNTANT24_HOME at it. */
  setup(): string;
  /** Remove the temp dir and restore the previous ACCOUNTANT24_HOME. */
  cleanup(): void;
  /** Join segments into the current workspace dir. */
  path(...segments: string[]): string;
}

export function makeTmpWorkspace(): TmpWorkspace {
  let dir = "";
  let prev: string | undefined;

  return {
    get dir() {
      return dir;
    },
    setup() {
      prev = process.env.ACCOUNTANT24_HOME;
      dir = mkdtempSync(path.join(tmpdir(), "a24-test-"));
      process.env.ACCOUNTANT24_HOME = dir;
      return dir;
    },
    cleanup() {
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = "";
      if (prev === undefined) delete process.env.ACCOUNTANT24_HOME;
      else process.env.ACCOUNTANT24_HOME = prev;
    },
    path(...segments) {
      return path.join(dir, ...segments);
    },
  };
}
