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

  // The same three lines the landing page opens with, in the same order.
  await expect(window.getByText("Accountant24", { exact: true })).toBeVisible();
  await expect(
    window.getByRole("heading", { name: "Open source AI agent for personal finance", exact: true }),
  ).toBeVisible();
  await expect(window.getByText("Runs on your machine, you own the data")).toBeVisible();
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

test("asks for a provider after Get started, with nothing to fill in until one is chosen", async () => {
  const window = await launched.app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  await window.getByRole("button", { name: "Get started" }).click();

  // The connect step asks one question: which provider. The list itself comes
  // from the real provider catalog over IPC.
  await expect(window.getByRole("heading", { name: "Connect an AI model" })).toBeVisible();
  await expect(window.getByRole("combobox")).toHaveText("Select a provider");
});
