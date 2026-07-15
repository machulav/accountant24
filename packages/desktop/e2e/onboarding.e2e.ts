import { expect, test } from "@playwright/test";
import { type LaunchedApp, launchApp } from "./helpers";

// E1 — the real app boots to the onboarding screen on a fresh install.
// Guards the whole wiring: main process starts, preload's allowlisted bridge is
// exposed, auth_status returns "no models", and the renderer paints Onboarding.
// No pi agent is needed (it only spawns once a model exists).

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched?.close();
});

test("boots to onboarding with the three connect options on a fresh install", async () => {
  const window = await launched.app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  // The onboarding headline + the three ways to get a model.
  await expect(window.getByText("Local-first AI agent for personal finance")).toBeVisible();
  await expect(window.getByText("Sign in with a subscription")).toBeVisible();
  await expect(window.getByText("Use an API key")).toBeVisible();
  await expect(window.getByText("Connect Ollama")).toBeVisible();
});

test("opens Settings on the Providers section when a connect option is clicked", async () => {
  const window = await launched.app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  await window.getByText("Use an API key").click();

  // The Settings dialog opens; its Providers section lists the "Available" group.
  await expect(window.getByText("Available")).toBeVisible();
});
