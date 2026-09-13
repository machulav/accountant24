# Accountant24 docs

Mintlify documentation site for accountant24, served at **accountant24.ai/docs**. Standard Mintlify docs (sidebar + navbar).

## Hosting

The root of accountant24.ai is the landing page (`packages/website`), a Cloudflare Worker serving static assets. The same Worker proxies `/docs`, `/docs/*`, `/mintlify-assets/*`, `/_mintlify/*` and `/.well-known/*` to this Mintlify project (`accountant24.mintlify.site`), which is configured in the Mintlify dashboard as "Host at accountant24.ai/docs".

URL structure: Mintlify adds the `/docs` prefix itself (the "Host at accountant24.ai/docs" setting), so pages live at the root of this folder: `index.mdx` serves `/docs`, `quickstart.mdx` serves `/docs/quickstart`. Write internal links without the prefix (`/quickstart`, not `/docs/quickstart`); Mintlify prepends it. Never nest pages in a `docs/` subfolder, that doubles the prefix (`/docs/docs/...`). The old root-level URLs (`/quickstart`, `/faq`, …) redirect via `packages/website/public/_redirects`.

`structured-data.js`, `analytics.js` and `style.css` are loaded by Mintlify on every page (JSON-LD, PostHog and the navbar wordmark size, all mirrored from the landing page).

## Local preview

```bash
npm i -g mint
npm run preview   # landing page + docs behind http://127.0.0.1:4321, both hot-reloading
npm run docs      # docs only, at http://localhost:3000
```

The docs script (`scripts/docs.sh`) forwards any other mint command, e.g. `npm run docs -- broken-links`, and runs mint with a Homebrew LTS node when the default node is too new for it.
