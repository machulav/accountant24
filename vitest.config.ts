import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// The extension inlines templates via `import x from "./f.md" with { type: "text" }`
// (a bun feature). Rewrite that attribute to vite's native `?raw` text import so
// vitest can load .md/.journal/.gitignore sources as strings. esbuild handles the
// same imports for the production bundle (see scripts/bundle-extension.ts).
function textImports(): Plugin {
  return {
    name: "accountant24-text-imports",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".ts") || !code.includes('with { type: "text" }')) return null;
      const out = code.replace(
        /from\s+("[^"]+")\s+with\s*\{\s*type:\s*"text"\s*\}/g,
        (_m, spec: string) => `from ${spec.slice(0, -1)}?raw"`,
      );
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [textImports()],
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
        "packages/pi-extension/src/entry.ts",
        "packages/pi-extension/src/spawn.ts",
        "packages/desktop/src/renderer/main.tsx",
        "packages/desktop/src/renderer/test/**",
        "packages/desktop/src/main/index.ts",
        "packages/desktop/src/preload/index.ts",
        "packages/desktop/src/renderer/rpc/types.ts",
        "packages/desktop/src/shared/**",
        "packages/pi-extension/src/scaffold/template/**",
      ],
      // Enforced floor — ratchets up toward 100 as gaps close; never lowered.
      // Kept just under the current effective baseline so the gate is honest
      // (green today) and each new test suite raises it.
      thresholds: {
        statements: 97.7,
        branches: 92.1,
        functions: 97.7,
        lines: 98.8,
      },
    },
  },
});
