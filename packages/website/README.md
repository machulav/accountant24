# Accountant24 website

The landing page at [accountant24.ai](https://accountant24.ai): an Astro static site served by a Cloudflare Worker that also proxies `/docs` to the Mintlify docs site (see `docs/README.md`).

## Develop

```bash
npm run preview                            # from the root: site + local docs with hot reload on http://127.0.0.1:4321
npm run dev -w @accountant24/website       # site only, /docs proxied to the live docs
npm run build -w @accountant24/website     # astro check + build into dist/
npm run preview -w @accountant24/website   # wrangler dev: dist/ + the Worker's docs proxy on http://localhost:8787
```

Copy and data live in `src/content/site.ts`. Pure logic (`src/lib/`, `src/worker/`) has unit tests in `__tests__/`, run by the root `npm test`. Brand images in `public/` come from the desktop app icon (`npm run brand-assets -w @accountant24/website`).

## Deploy

`.github/workflows/website.yml` uploads a preview version for every pull request, posts the branch's preview URL (the same on every push) in a comment on the PR, and deploys on push to `main` (plus a daily rebuild that refreshes the latest version used in the page metadata). It needs the repo secrets `CLOUDFLARE_API_TOKEN` (token template "Edit Cloudflare Workers") and `CLOUDFLARE_ACCOUNT_ID`.

## Analytics

PostHog (EU) in cookieless mode: no cookies or storage, no person profiles, no recordings, no heatmaps or web vitals, so no consent banner; the client loads no script beyond its own bundle. The project token goes into `site.posthogKey` (`src/content/site.ts`) and `docs/analytics.js`; an empty token disables analytics. CTAs carry `data-track` / `data-placement` attributes and emit `download_clicked`, `github_clicked`, `docs_clicked`.

## Production

`accountant24.ai` is the Worker's custom domain, declared as `routes` in `wrangler.jsonc`, so every deploy keeps it attached. Mintlify serves the docs with "Host at" set to `accountant24.ai/docs`, which means it prefixes `/docs` to every page path: the mdx files live at the root of `docs/`, and their links are written relative to that root.

Two pieces live only in the Cloudflare dashboard, outside this repo: the `www` DNS record with the Redirect Rule sending `www.accountant24.ai/*` to `https://accountant24.ai/$1` (301), and the zone settings.

After a change that touches routing, redirects or the proxy, smoke test the live domain: `/`, `/docs`, `/docs/quickstart`, `/quickstart` (301), `/llms.txt`, `/sitemap-index.xml`, `/docs/sitemap.xml`, the Google Rich Results test on `/`, and live events in PostHog.
