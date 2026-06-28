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
  test: {
    include: ["packages/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // bun:test reset mocks per test (the old tests reassigned Bun.spawn each time);
    // clear call history before each test so toHaveBeenCalledTimes() stays per-test.
    clearMocks: true,
    coverage: { provider: "v8" },
  },
});
