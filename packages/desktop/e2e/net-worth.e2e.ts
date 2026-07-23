import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type LaunchedApp, launchApp } from "./helpers";

// E2 — the Net Worth view over the real wiring: the preload allowlist,
// the ledger_net_worth IPC round trip, and the sidebar view switch. A
// stored API key makes the app boot into the chat layout (the pi agent only
// spawns on the first send, which never happens here). The temp home has no
// journal, so the view deterministically shows the empty state whether or
// not an hledger binary is around.

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({
    seed: (home) => {
      writeFileSync(path.join(home, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "sk-test" } }));
    },
  });
});

test.afterEach(async () => {
  await launched?.close();
});

test("opens the Net Worth view from the sidebar and returns to the chat", async () => {
  const window = await launched.app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  // Booted past onboarding into the chat layout (composer present).
  await expect(window.getByLabel("Message input")).toBeVisible();

  await window.getByRole("button", { name: "Net Worth" }).click();
  await expect(window.getByRole("heading", { name: "Net Worth" })).toBeVisible();
  await expect(window.getByText("No accounts yet")).toBeVisible();

  // Toggling the entry brings the chat back.
  await window.getByRole("button", { name: "Net Worth" }).click();
  await expect(window.getByRole("heading", { name: "Net Worth" })).not.toBeVisible();
  await expect(window.getByLabel("Message input")).toBeVisible();
});
