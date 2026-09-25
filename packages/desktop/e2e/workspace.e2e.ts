import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type LaunchedApp, launchApp } from "./helpers";

// E4 — the `--workspace <path>` launch flag over the real wiring: main parses
// argv, the flag beats ACCOUNTANT24_WORKSPACE (which the helper always sets to a
// decoy temp dir), the workspace is seeded at the flagged path, and Settings →
// About shows that path through the preload allowlist + workspace_dir IPC.

let launched: LaunchedApp;
let flagHome: string;

test.beforeEach(async () => {
  flagHome = mkdtempSync(path.join(tmpdir(), "a24-e2e-flag-"));
  // A provider in the flagged workspace boots the app into the chat (where
  // Settings lives); the decoy stays empty, so a flag parser that fell through
  // to it would land on onboarding instead and fail below.
  writeFileSync(path.join(flagHome, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "sk-test" } }));
  launched = await launchApp({ args: ["--workspace", flagHome] });
});

test.afterEach(async () => {
  await launched?.close();
  rmSync(flagHome, { recursive: true, force: true });
});

test("uses the --workspace folder instead of ACCOUNTANT24_WORKSPACE and shows it in Settings → About", async () => {
  const window = await launched.app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await expect(window.getByLabel("Message input")).toBeVisible();

  // Seeded at the flagged path, not in the env-var decoy.
  expect(existsSync(path.join(flagHome, "ledger", "main.journal"))).toBe(true);
  expect(existsSync(path.join(flagHome, ".git"))).toBe(true);
  expect(existsSync(path.join(launched.home, "ledger"))).toBe(false);

  // Settings → About → the Workspace row shows the absolute path. (Never click
  // it here: it would open the Finder on the test machine.)
  await window.getByRole("button", { name: "Settings" }).click();
  await window.getByRole("button", { name: "About", exact: true }).click();
  await expect(window.getByText(flagHome)).toBeVisible();
});
