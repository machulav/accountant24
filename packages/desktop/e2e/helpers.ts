// Shared helpers for the Electron E2E smoke tests.
//
// Each test launches the built app pointed at a fresh temp ACCOUNTANT24_HOME.
// Empty, it boots deterministically to the onboarding screen (no providers =>
// no models => onboarding, and the pi agent child is never spawned); a `seed`
// callback can pre-populate the home (e.g. auth.json) to boot into the chat
// layout instead — the agent still only spawns on the first send.

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
export async function launchApp(
  opts: { env?: Record<string, string>; seed?: (home: string) => void } = {},
): Promise<LaunchedApp> {
  const home = mkdtempSync(path.join(tmpdir(), "a24-e2e-"));
  opts.seed?.(home);
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
      ...opts.env,
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
