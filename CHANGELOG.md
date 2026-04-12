# Changelog

## v0.1.1

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.0...v0.1.1)

### 🚀 Features

- Add tags to @ autocomplete, system prompt, and /tags command ([26222e3](https://github.com/machulav/accountant24/commit/26222e3))
- Format /accounts, /payees, /tags output with markdown and sorting ([cddd018](https://github.com/machulav/accountant24/commit/cddd018))
- Add custom tool rendering with expandable details and error states ([d7ddacb](https://github.com/machulav/accountant24/commit/d7ddacb))
- Add colored diff view to add_transaction and update_memory tools ([8978231](https://github.com/machulav/accountant24/commit/8978231))
- Override built-in tools with consistent custom rendering ([de1204a](https://github.com/machulav/accountant24/commit/de1204a))
- Add settings.json to scaffold template ([9716820](https://github.com/machulav/accountant24/commit/9716820))
- Auto-commit and push changes after agent finishes work ([b4b6c86](https://github.com/machulav/accountant24/commit/b4b6c86))
- Add extract_text tool for PDF and image text extraction ([46533f2](https://github.com/machulav/accountant24/commit/46533f2))
- Replace auto-commit hook with explicit commit_and_push tool ([54b90d1](https://github.com/machulav/accountant24/commit/54b90d1))
- Add /memory command and rename <known-payees> to <payees> ([79bc3a4](https://github.com/machulav/accountant24/commit/79bc3a4))
- Hardcode pi settings, filter /model list, and pass editor options ([24b8bab](https://github.com/machulav/accountant24/commit/24b8bab))
- Ship as standalone bun binary via homebrew tap ([ba61fcb](https://github.com/machulav/accountant24/commit/ba61fcb))

### 🐞 Bug Fixes

- Use ACCOUNTANT24_HOME instead of process.cwd() for builtin tools ([4ca268e](https://github.com/machulav/accountant24/commit/4ca268e))
- Use changelogen output for GitHub release notes ([d780a7e](https://github.com/machulav/accountant24/commit/d780a7e))

### ♻️ Refactors

- Consolidate data access into dedicated data/ layer ([172e698](https://github.com/machulav/accountant24/commit/172e698))
- Remove .js extensions from relative imports ([3f1c4c9](https://github.com/machulav/accountant24/commit/3f1c4c9))
- Rename Ls tool label to List ([dbde648](https://github.com/machulav/accountant24/commit/dbde648))
- Move default workspace to ~/Accountant24 ([3d69b99](https://github.com/machulav/accountant24/commit/3d69b99))

### 📖 Documentation

- Rewrite README as marketing-focused project landing page ([c5dc834](https://github.com/machulav/accountant24/commit/c5dc834))
- Reframe README feature subsections as user actions ([9568534](https://github.com/machulav/accountant24/commit/9568534))
- Simplify set-rules example and tighten feature descriptions ([c772648](https://github.com/machulav/accountant24/commit/c772648))
- Polish README ([#4](https://github.com/machulav/accountant24/pull/4))
- Remove inline links from README prose ([68bc56d](https://github.com/machulav/accountant24/commit/68bc56d))
- Refine README example prompts ([dff005b](https://github.com/machulav/accountant24/commit/dff005b))
- Fix default workspace path and expand comparison table ([c409819](https://github.com/machulav/accountant24/commit/c409819))
- Expand DSL acronym in philosophy section ([24be562](https://github.com/machulav/accountant24/commit/24be562))

### 📦 Build

- Add conventional commits, git hooks, and release tooling ([f287096](https://github.com/machulav/accountant24/commit/f287096))
- Tighten commitlint rules and add changelogen config ([c035a35](https://github.com/machulav/accountant24/commit/c035a35))

### 🏡 Chore

- Remove unused HledgerNotFoundError import ([b41d94d](https://github.com/machulav/accountant24/commit/b41d94d))

## v0.1.0

Initial release of Accountant24.
