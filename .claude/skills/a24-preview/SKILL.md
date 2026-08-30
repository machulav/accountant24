---
name: a24-preview
description: Run the website and docs locally for review with hot reload (landing page + Mintlify docs behind one URL), or the landing page as the production Cloudflare Worker. Use when website (packages/website) or docs (docs/**/*.mdx) files changed and the user wants to see or verify them in a browser, or asks to start/stop the preview.
---

# Preview the site locally

## Start (default: everything, hot reload)

From the repo root, run in the background:

```sh
npm run preview
```

It starts the Mintlify docs server (`mint dev`, port 3000) and the Astro dev server for the landing page, and serves both at **http://127.0.0.1:4321**: `/` is the landing page, `/docs/<file-stem>` are the docs (`docs/docs/plugins.mdx` → `/docs/plugins`), proxied to the local mint. Edits under `packages/website/src`, `docs/**/*.mdx` and `docs/docs.json` reload in the browser. The docs alone are also reachable at http://localhost:3000.

Wait ~15s (mint is slow to start), then confirm:

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4321/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4321/docs/quickstart
```

If port 4321 or 3000 is busy, a preview is already running; reuse it rather than starting a second one. The Astro dev server daemonizes itself; manage it from `packages/website` with `npx astro dev status|logs|stop`.

## Website only, against the live docs

From `packages/website`: `npx astro dev --background --port 4321 --host 127.0.0.1`. Same URL; `/docs` is proxied to the live Mintlify site instead of a local one.

## Production-like landing page (Cloudflare Worker)

```sh
npm run build -w @accountant24/website
cd packages/website && WRANGLER_SEND_METRICS=false nohup npx wrangler dev --port 8787 > /tmp/wrangler.log 2>&1 &
```

Serves **http://localhost:8787** from `dist/` through the Worker, with the docs proxied to the live Mintlify. No hot reload: `astro build` replaces `dist/`, which kills `wrangler dev`, so rebuild, then restart it (`lsof -ti tcp:8787 | xargs kill` first). Checks worth running here: `/quickstart` returns 301 to `/docs/quickstart`, `/docs/quickstart` returns 200 through the proxy, an unknown path returns the 404 page, `/` carries the `_headers` security headers.

## Check before handing over

- Docs: `npm run docs -- broken-links` validates internal links.
- Website: `npm run build -w @accountant24/website` runs `astro check` and the build.

## Screenshots

When the Chrome extension is not connected, use the repo's Playwright Chromium: a small script importing `chromium` from `node_modules/playwright/index.mjs`, `browser.newContext({ viewport, colorScheme: "light" | "dark" })`, `page.goto(url, { waitUntil: "networkidle" })`, `page.screenshot({ path, fullPage })`. Check 1280, 768 and 375 widths and both color schemes; read the PNGs to judge them.

## Stop

Stop the `npm run preview` process (it stops mint with it); if the Astro dev server lingers, `npx astro dev stop` in `packages/website`. Kill the process on port 8787 for the Worker preview. Leave nothing running when done.
