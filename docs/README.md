# Accountant24 docs

Mintlify documentation site for accountant24, deployed to the root of
**accountant24.ai**. Standard Mintlify docs (sidebar + navbar); no custom
landing page. Pages are scaffold stubs for now.

## Local preview

```bash
npm i -g mint
npm run docs
```

Then open `http://localhost:3000/`. The script (`scripts/docs.sh`) forwards
any other mint command, e.g. `npm run docs -- broken-links`, and runs mint
with a Homebrew LTS node when the default node is too new for it.
