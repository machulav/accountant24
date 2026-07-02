// Node ESM loader hook: lets `import x from "./f.md" with { type: "text" }`
// (and .journal / .gitignore) resolve to the file's contents as a string default
// export. Bun did this natively; node/tsx don't, so register this when running
// source that uses text imports:
//   node --import tsx --import ./scripts/text-import-register.mjs <script.ts>
// The desktop bundle handles the same imports via esbuild's text loader, and
// vitest via a transform in vitest.config.ts.
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const TEXT_RE = /\.(md|journal|gitignore)$/;

registerHooks({
  load(url, context, nextLoad) {
    if (context.importAttributes?.type === "text" || TEXT_RE.test(new URL(url).pathname)) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      return { format: "module", source: `export default ${JSON.stringify(source)};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
