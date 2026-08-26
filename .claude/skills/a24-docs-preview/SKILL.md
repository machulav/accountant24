---
name: a24-docs-preview
description: Run the docs website locally for review. Use when docs pages (docs/**/*.mdx) changed and the user wants to see or verify them in a browser, or asks to start/stop the docs preview.
---

# Preview the docs site locally

## Start

From the repo root, run in the background:

```sh
npm run docs
```

It serves the Mintlify site at **http://localhost:3000** (pages live at
`/docs/<file-stem>`, e.g. `docs/docs/plugins.mdx` → `/docs/plugins`). The
script handles Node version quirks itself (mint refuses non-LTS Node and the
wrapper falls back to a Homebrew LTS node).

Wait ~10s, then confirm with:

```sh
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Edits to `.mdx` files and `docs.json` hot-reload; no restart needed.

## Check before handing over

- `npm run docs -- broken-links` validates internal links.
- If port 3000 is busy, another preview is already running; reuse it rather
  than starting a second one.

## Stop

Kill the background `mint dev` process when done (it holds port 3000).
