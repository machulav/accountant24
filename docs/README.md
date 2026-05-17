# Accountant24 site

Mintlify project for accountant24, deployed to the root of
**accountant24.ai**.

## Structure

- `index.mdx` — the marketing landing page at `/` (`mode: "custom"`,
  full-width, no sidebar).
- All other pages (`quickstart`, …) are documentation, rendered with the
  docs sidebar. They are scaffold stubs for now.

## Local preview

```bash
npm i -g mint
cd docs
mint dev
```

The landing is at `http://localhost:3000/`, docs at
`http://localhost:3000/quickstart`.
