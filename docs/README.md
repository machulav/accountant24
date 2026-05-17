# Accountant24 docs

Mintlify documentation site for accountant24. Cleaned of the starter-kit
demo content; only a placeholder home page remains.

## Local preview

```bash
npm i -g mint   # or: npx mint
cd docs
mint dev
```

View the local preview at `http://localhost:3000`.

## TODO before launch

- [ ] Add brand assets: `logo/light.svg`, `logo/dark.svg`, `favicon.svg`,
      then point `docs.json` (`logo`, `favicon`) at the real paths
- [ ] Write real pages and build out `navigation` in `docs.json`
- [ ] Restore `navbar` links / primary button (e.g. GitHub repo) in `docs.json`
- [ ] Add `footer.socials` in `docs.json` once channels exist
