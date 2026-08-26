import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror the desktop app's `@` alias so component tests can load sources
    // that import via "@/...".
    alias: { "@": new URL("./packages/desktop/src/renderer", import.meta.url).pathname },
  },
  test: {
    include: ["packages/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // bun:test reset mocks per test (the old tests reassigned Bun.spawn each time);
    // clear call history before each test so toHaveBeenCalledTimes() stays per-test.
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Measure our own source only. `all: true` counts files with zero tests
      // too, so coverage reflects the real surface — not just what tests touched.
      all: true,
      // Only instrument TS/TSX — text assets imported as strings (.md/.journal/
      // .gitignore) would otherwise make v8's coverage parser choke on them.
      include: ["packages/*/src/**/*.{ts,tsx}"],
      // Excluded = not worth testing: tests/fixtures, barrels, entry/glue, stock
      // third-party UI (shadcn — never edited per AGENTS.md), type-only files,
      // and generated/template assets.
      exclude: [
        "**/__tests__/**",
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/index.ts",
        "**/components/shadcn/**",
        "**/components/reui/**",
        "packages/pi-extension/src/entry.ts",
        "packages/pi-extension/src/spawn.ts",
        "packages/desktop/src/renderer/main.tsx",
        "packages/desktop/src/renderer/test/**",
        "packages/desktop/src/main/index.ts",
        "packages/desktop/src/preload/index.ts",
        "packages/desktop/src/renderer/rpc/types.ts",
        "packages/desktop/src/shared/**",
        "packages/desktop/src/main/template/**",
      ],
      // Enforced floor — ratchets up toward 100 as gaps close; never lowered.
      // Kept just under the current effective baseline so the gate is honest
      // (green today) and each new test suite raises it.
      thresholds: {
        statements: 98.5,
        branches: 95,
        functions: 98.3,
        lines: 99.5,
      },
    },
  },
});
