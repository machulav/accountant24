import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type LaunchedApp, launchApp } from "./helpers";

// E3 — the Transactions view over the real wiring: the preload allowlist,
// the ledger_transactions IPC round trip, and the sidebar view switch. A
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

test("opens the Transactions view from the sidebar and returns to the chat", async () => {
  const window = await launched.app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  // Booted past onboarding into the chat layout (composer present).
  await expect(window.getByLabel("Message input")).toBeVisible();

  await window.getByRole("button", { name: "Transactions" }).click();
  await expect(window.getByRole("heading", { name: "Transactions" })).toBeVisible();
  await expect(window.getByText("No transactions yet")).toBeVisible();

  // New Chat brings the composer back (sidebar entries select, not toggle).
  await window.getByRole("button", { name: "New Chat" }).click();
  await expect(window.getByRole("heading", { name: "Transactions" })).not.toBeVisible();
  await expect(window.getByLabel("Message input")).toBeVisible();
});
