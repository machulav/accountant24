import { defineConfig } from "@playwright/test";

// E2E smoke tier — launches the REAL built Electron app (see packages/desktop/e2e).
// Separate from the Vitest suite: run with `npm run e2e` (needs `npm run build`
// first). testMatch is scoped to *.e2e.ts so Playwright never picks up the
// hundreds of Vitest *.test.ts files across the repo.
export default defineConfig({
  testDir: "packages/desktop/e2e",
  testMatch: "**/*.e2e.ts",
  // Electron launch + first paint can be slow; keep generous but bounded.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Electron apps are single-instance here; run serially for determinism.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "list" : "line",
});
