# Changelog

## v0.1.3

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.2...v0.1.3)

### 🐞 Bug Fixes

- Use `;` for transaction comments instead of `#` ([9460047](https://github.com/machulav/accountant24/commit/9460047))

## v0.1.2

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.1...v0.1.2)

### 🚀 Features

- Support multi-currency net worth in briefing ([066b5a9](https://github.com/machulav/accountant24/commit/066b5a9))
- Support multi-currency spent/income in briefing ([b31ce37](https://github.com/machulav/accountant24/commit/b31ce37))
- Add <tools> section and <context> wrapper to system prompt ([2256013](https://github.com/machulav/accountant24/commit/2256013))

### 🐞 Bug Fixes

- Remove unused join import from ledger.ts ([91f7ff6](https://github.com/machulav/accountant24/commit/91f7ff6))
- Remove unused renderSectionDivider method ([22632fb](https://github.com/machulav/accountant24/commit/22632fb))
- Prevent onboarding header flicker on startup ([2128f5c](https://github.com/machulav/accountant24/commit/2128f5c))
- Resolve all biome lint warnings in test files ([f1ec91c](https://github.com/machulav/accountant24/commit/f1ec91c))
- Refresh autocomplete after agent turn instead of before ([36aae51](https://github.com/machulav/accountant24/commit/36aae51))

### ♻️ Refactors

- Remove journal beautifier from the agent ([37d7265](https://github.com/machulav/accountant24/commit/37d7265))
- Remove Last Transactions section from briefing ([327c172](https://github.com/machulav/accountant24/commit/327c172))
- Move tool prompt guidelines into system prompt ([40bffb6](https://github.com/machulav/accountant24/commit/40bffb6))
- Extract onboarding header and decouple from briefing ([e4254e4](https://github.com/machulav/accountant24/commit/e4254e4))
- Flatten headers directory structure and add shared tests ([02293d6](https://github.com/machulav/accountant24/commit/02293d6))
- Use currency codes instead of symbols in categories ([a398fcd](https://github.com/machulav/accountant24/commit/a398fcd))
- Extract loader updateDisplay into its own module ([fc22b5d](https://github.com/machulav/accountant24/commit/fc22b5d))
- Modularize extension into domain-focused directories ([7d63c96](https://github.com/machulav/accountant24/commit/7d63c96))
- Reorder tools and rename <session> to <date> tag ([76f3b76](https://github.com/machulav/accountant24/commit/76f3b76))
- Restructure system prompt with soul and invariants/heuristics ([d0e10e2](https://github.com/machulav/accountant24/commit/d0e10e2))

### ✅ Tests

- Add unit tests for ledger, memory, and tool rendering modules ([359bb81](https://github.com/machulav/accountant24/commit/359bb81))

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
