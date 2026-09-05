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

## Cutover checklist (one-time)

1. Deploy once (`npm run deploy -w @accountant24/website` or the workflow) and check the `workers.dev` URL: the home page renders, `/docs/quickstart` comes through the proxy, `/quickstart` redirects to `/docs/quickstart`.
2. Mintlify dashboard: Custom domain, enable "Host at", domain `accountant24.ai`, path `/docs`.
3. Cloudflare dashboard: the Worker, Settings, Domains & Routes, add `accountant24.ai` (replace the existing DNS record pointing at Mintlify). Then add `"routes": [{ "pattern": "accountant24.ai", "custom_domain": true }]` to `wrangler.jsonc` so deploys stay declarative.
4. Cloudflare dashboard: Rules, Redirect Rules, redirect `www.accountant24.ai/*` to `https://accountant24.ai/$1` (301).
5. Smoke test on the live domain: `/`, `/docs`, `/docs/quickstart`, `/quickstart` (301), `/llms.txt`, `/sitemap-index.xml`, `/docs/sitemap.xml`, the Google Rich Results test on `/`, and live events in PostHog.
