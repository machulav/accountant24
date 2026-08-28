import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type LaunchedApp, launchApp } from "./helpers";

// E5 — the prompt ideas on the New Chat page over the real wiring: the
// ledger_transaction_count IPC round trip (preload allowlist included) and a
// suggestion click landing in the composer. A stored API key makes the app
// boot into the chat layout; the workspace scaffolds the template journal,
// which has no transactions, so the ideas deterministically come from the
// Getting started group. Nothing is sent, so the pi agent never spawns.

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

test("shows five prompt ideas under the composer, and a click fills the composer without sending", async () => {
  const window = await launched.app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  const input = window.getByLabel("Message input");
  await expect(input).toBeVisible();

  const ideas = window.getByRole("list", { name: "Prompt ideas" }).getByRole("button");
  await expect(ideas).toHaveCount(5);

  const first = ideas.first();
  const prompt = (await first.textContent()) ?? "";
  expect(prompt).not.toBe("");
  await first.click();

  await expect(input).toHaveText(prompt);
  // Focused with the caret after the idea: typing continues the prompt.
  await expect(input.getByRole("textbox")).toBeFocused();
  await window.keyboard.type(" please");
  await expect(input).toHaveText(`${prompt} please`);
  // Filled, not sent: no user message appears and the ideas stay.
  await expect(window.locator('[data-role="user"]')).toHaveCount(0);
  await expect(ideas).toHaveCount(5);
});
