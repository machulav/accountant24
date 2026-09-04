// Bundle the pi extension to a single self-contained ESM file that the desktop
// app loads via `pi -e`. pi's virtual modules are externalized so they resolve
// against node_modules at load time (the agent runs under Electron-as-Node, so
// node_modules is present). This is the lightweight dev/prelaunch step; the
// release build calls the same bundling.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "packages", "desktop", "resources", "accountant24-extension.js");
const SYSTEM_MD_SRC = join(ROOT, "packages", "pi-extension", "src", "system-prompt", "system.md");
const SYSTEM_MD_OUT = join(ROOT, "packages", "desktop", "resources", "system.md");

// Mirrors the alias table pi's extension loader injects (its own
// VIRTUAL_MODULES, in core/extensions/loader.ts). Bundling any of these would
// give the extension a second copy of a module pi expects to be a singleton, so
// re-check this list against the loader on every pi upgrade.
const VIRTUAL_MODULES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat",
  "@earendil-works/pi-ai/oauth",
  "@earendil-works/pi-ai/providers/all",
  "typebox",
  "typebox/compile",
  "typebox/value",
  "@sinclair/typebox",
  "@sinclair/typebox/compile",
  "@sinclair/typebox/value",
];

await build({
  entryPoints: [join(ROOT, "packages", "pi-extension", "src", "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: OUT,
  external: VIRTUAL_MODULES,
  logLevel: "info",
});

// system.md ships as its own resource: the app passes it to pi via
// --system-prompt, so pi natively appends the skills block around it.
copyFileSync(SYSTEM_MD_SRC, SYSTEM_MD_OUT);

// The docs site ships with the app as plain markdown, so the agent can answer
// questions about the app from the docs of the version that is actually
// running (offline, and never newer than the app). The folder reaches the
// agent host as ACCOUNTANT24_DOCS (env.ts agentEnv) and the model as the
// prompt's <docs-folder> block (the extension). docs.json's navigation
// decides which pages ship and in what order, and contents.md is a generated
// catalog of them, so the system prompt needs no hardcoded page list.
const DOCS_SRC = join(ROOT, "docs");
const DOCS_OUT = join(ROOT, "packages", "desktop", "resources", "docs");

interface DocsPage {
  title: string;
  description: string;
  body: string;
}

function parsePage(mdx: string): DocsPage {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(mdx);
  const title = fm ? /^title:\s*"?(.*?)"?\s*$/m.exec(fm[1])?.[1] : undefined;
  const description = fm ? /^description:\s*"?(.*?)"?\s*$/m.exec(fm[1])?.[1] : undefined;
  return { title: title ?? "Untitled", description: description ?? "", body: fm ? mdx.slice(fm[0].length) : mdx };
}

/** One docs page: mdx → plain markdown the agent can read. */
function pageToMarkdown(page: DocsPage): string {
  // The title becomes the H1 and the description the lead line, which is
  // exactly how the site renders them.
  const head = `# ${page.title}\n\n${page.description ? `${page.description}\n\n` : ""}`;
  let text = page.body;
  // <Warning> keeps its text as a blockquote; <video> is site-only chrome.
  text = text.replace(/<Warning>([\s\S]*?)<\/Warning>/g, (_, body: string) => {
    const inner = body.trim().split("\n").map((line: string) => `> ${line.trim()}`.trimEnd()).join("\n");
    return `> **Warning**\n${inner}`;
  });
  text = text.replace(/<video[\s\S]*?\/>/g, "");
  // Site-relative links become absolute, so quoted links work for the user.
  text = text.replace(/\]\(\//g, "](https://accountant24.ai/");
  return `${head}${text}`.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

rmSync(DOCS_OUT, { recursive: true, force: true });
mkdirSync(DOCS_OUT, { recursive: true });
const nav = JSON.parse(readFileSync(join(DOCS_SRC, "docs.json"), "utf8")) as {
  navigation: { groups: { pages: string[] }[] };
};
const contents: string[] = [];
for (const navPage of nav.navigation.groups.flatMap((g) => g.pages)) {
  const name = basename(navPage);
  const page = parsePage(readFileSync(join(DOCS_SRC, `${navPage}.mdx`), "utf8"));
  writeFileSync(join(DOCS_OUT, `${name}.md`), pageToMarkdown(page));
  contents.push(`- \`${name}.md\` (${page.title}): ${page.description || page.title}`);
}
writeFileSync(join(DOCS_OUT, "contents.md"), `# Documentation pages\n\n${contents.join("\n")}\n`);

console.log(`[bundle-extension] → ${OUT}`);
console.log(`[bundle-extension] → ${SYSTEM_MD_OUT}`);
console.log(`[bundle-extension] → ${DOCS_OUT}`);
