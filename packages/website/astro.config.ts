import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// In production the Cloudflare Worker proxies the docs paths to Mintlify
// (src/worker). The dev server mirrors that so docs links work with hot
// reload: by default against the live docs, or against a local `mint dev`
// when DOCS_PROXY_TARGET points at it (see scripts/preview.sh at the root).
const localMint = process.env.DOCS_PROXY_TARGET;
const docsProxy = {
  target: localMint ?? "https://accountant24.mintlify.site",
  changeOrigin: true,
  ws: true,
  headers: { "X-Forwarded-Host": "accountant24.ai", "X-Forwarded-Proto": "https" },
  // The hosted docs are configured as "Host at accountant24.ai/docs", so
  // Mintlify itself serves every page under /docs. A local `mint dev` knows
  // nothing about that setting and serves the pages at the root, so strip the
  // prefix only for it.
  rewrite: (path: string) => (localMint ? path.replace(/^\/docs(?=\/|$)/, "") || "/" : path),
};
// `/_next` and `/socket.io` are where a local `mint dev` serves its assets and
// live-reload socket; harmless against the live docs.
const docsPaths = ["/docs", "/mintlify-assets", "/_mintlify", "/.well-known", "/_next", "/socket.io"];

export default defineConfig({
  site: "https://accountant24.ai",
  build: {
    // `file` emits `404.html` at the root, which is what Cloudflare's
    // `not_found_handling: "404-page"` serves for unknown paths.
    format: "file",
    // The styles go into the page: two small stylesheets fetched before the
    // first paint cost a phone half a second, and a stylesheet cached across
    // pages buys nothing on a site with two of them.
    inlineStylesheets: "always",
  },
  integrations: [sitemap({ filter: (page) => !page.includes("/404") })],
  vite: {
    plugins: [tailwindcss()],
    server: { proxy: Object.fromEntries(docsPaths.map((path) => [path, docsProxy])) },
  },
});
