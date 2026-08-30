import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// In production the Cloudflare Worker proxies the docs paths to Mintlify
// (src/worker). The dev server mirrors that so docs links work with hot
// reload: by default against the live docs, or against a local `mint dev`
// when DOCS_PROXY_TARGET points at it (see scripts/preview.sh at the root).
const docsProxy = {
  target: process.env.DOCS_PROXY_TARGET ?? "https://accountant24.mintlify.site",
  changeOrigin: true,
  ws: true,
  headers: { "X-Forwarded-Host": "accountant24.ai", "X-Forwarded-Proto": "https" },
  // Until "Host at /docs" is enabled, the docs home (index.mdx) lives at the
  // Mintlify root; map bare /docs onto it so the preview matches the final UX.
  rewrite: (path: string) => (path === "/docs" ? "/" : path),
};
// `/_next` and `/socket.io` are where a local `mint dev` serves its assets and
// live-reload socket; harmless against the live docs.
const docsPaths = ["/docs", "/mintlify-assets", "/_mintlify", "/.well-known", "/_next", "/socket.io"];

export default defineConfig({
  site: "https://accountant24.ai",
  // `file` emits `404.html` at the root, which is what Cloudflare's
  // `not_found_handling: "404-page"` serves for unknown paths.
  build: { format: "file" },
  integrations: [sitemap({ filter: (page) => !page.includes("/404") })],
  vite: {
    plugins: [tailwindcss()],
    server: { proxy: Object.fromEntries(docsPaths.map((path) => [path, docsProxy])) },
  },
});
