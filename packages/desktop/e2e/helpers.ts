// Shared helpers for the Electron E2E smoke tests.
//
// Each test launches the built app pointed at a fresh, empty temp
// ACCOUNTANT24_HOME so it boots deterministically to the onboarding screen (no
// providers => no models => onboarding, and the pi agent child is never spawned).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, _electron as electron } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
/** packages/desktop — the app root; its build output is out/main/index.js. */
export const DESKTOP_DIR = path.resolve(here, "..");
export const MAIN_ENTRY = path.join(DESKTOP_DIR, "out", "main", "index.js");

export interface LaunchedApp {
  app: ElectronApplication;
  home: string;
  close(): Promise<void>;
}

/** Launch the built app with an isolated temp workspace. */
export async function launchApp(env: Record<string, string> = {}): Promise<LaunchedApp> {
  const home = mkdtempSync(path.join(tmpdir(), "a24-e2e-"));
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      ACCOUNTANT24_HOME: home,
      // Never talk to the update feed or analytics in tests.
      A24_FAKE_UPDATE: "",
      CI: "1",
      // Per-test overrides (e.g. an agent-stub flag) win.
      ...env,
    } as Record<string, string>,
  });
  return {
    app,
    home,
    async close() {
      await app.close().catch(() => undefined);
      rmSync(home, { recursive: true, force: true });
    },
  };
}
