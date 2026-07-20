# Accountant24 docs

Mintlify documentation site for accountant24, deployed to the root of
**accountant24.ai**. Standard Mintlify docs (sidebar + navbar); no custom
landing page yet. Pages are scaffold stubs for now.

URL structure: `index.mdx` serves `/` and acts as the landing page until a
real marketing site takes over the root. All other pages live in `docs/`
so their URLs are `accountant24.ai/docs/...` — final URLs that won't move
when the website ships (the site will then be served at `/` and `/docs/*`
proxied to Mintlify). Old root-level URLs 301 via `redirects` in
`docs.json`. Keep new pages inside `docs/`.

## Local preview

```bash
npm i -g mint
npm run docs
```

Then open `http://localhost:3000/`. The script (`scripts/docs.sh`) forwards
any other mint command, e.g. `npm run docs -- broken-links`, and runs mint
with a Homebrew LTS node when the default node is too new for it.
