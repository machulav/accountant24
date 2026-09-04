import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type LaunchedApp, launchApp } from "./helpers";

// E1 — the real app boots to the onboarding wizard on a fresh install.
// Guards the whole wiring: main process starts, preload's allowlisted bridge is
// exposed, auth_status returns "no models", and the renderer paints the welcome
// page. No pi agent is needed (it only spawns once a model exists).

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched?.close();
});

test("boots to the welcome page on a fresh install", async () => {
  const window = await launched.app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  await expect(window.getByRole("heading", { name: "Accountant24" })).toBeVisible();
  await expect(window.getByText("Local-first AI agent for personal finance.")).toBeVisible();
  await expect(window.getByRole("button", { name: "Get started" })).toBeVisible();
});

test("seeds the workspace on a fresh install, before any chat exists", async () => {
  const window = await launched.app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  // The app (not the agent) creates the workspace at launch, so the ledger and
  // its git repo are there even though no message has been sent.
  expect(existsSync(path.join(launched.home, "ledger", "main.journal"))).toBe(true);
  expect(existsSync(path.join(launched.home, "memory.md"))).toBe(true);
  expect(existsSync(path.join(launched.home, ".git"))).toBe(true);
});

test("shows the provider list after Get started, with Start held until a model exists", async () => {
  const window = await launched.app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  await window.getByRole("button", { name: "Get started" }).click();

  // The setup step embeds the Providers pane (its "Available" group comes from
  // the real auth_status), and Start waits for a model.
  await expect(window.getByText("Available")).toBeVisible();
  await expect(window.getByRole("button", { name: "Start" })).toBeDisabled();
});
