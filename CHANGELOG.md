# Changelog

## v0.2.6

[compare changes](https://github.com/machulav/accountant24/compare/v0.2.5...v0.2.6)

### 🚀 Features

- **desktop:** Restyle the UI ([#16](https://github.com/machulav/accountant24/pull/16))

### 🐞 Bug Fixes

- **desktop:** Count document attachments in user_message_sent analytics ([b383b9d](https://github.com/machulav/accountant24/commit/b383b9d))

### 📖 Documentation

- Update desktop app screenshot ([b0c9dce](https://github.com/machulav/accountant24/commit/b0c9dce))

## v0.2.5

[compare changes](https://github.com/machulav/accountant24/compare/v0.2.4...v0.2.5)

### 🐞 Bug Fixes

- **desktop:** Hide the pi sidecar's Dock icon ([c83faea](https://github.com/machulav/accountant24/commit/c83faea))

## v0.2.4

[compare changes](https://github.com/machulav/accountant24/compare/v0.2.3...v0.2.4)

### 🚀 Features

- **desktop:** Track auto-update outcomes in anonymous analytics ([8993803](https://github.com/machulav/accountant24/commit/8993803))
- **desktop:** Link to the release changelog from settings ([2ac7e29](https://github.com/machulav/accountant24/commit/2ac7e29))

### 🐞 Bug Fixes

- **desktop:** Stamp new chat's first message with its own model ([6981037](https://github.com/machulav/accountant24/commit/6981037))

### ♻️ Refactors

- **desktop:** Consistent analytics event names and typed wrappers ([ba6f6ff](https://github.com/machulav/accountant24/commit/ba6f6ff))

## v0.2.3

[compare changes](https://github.com/machulav/accountant24/compare/v0.2.2...v0.2.3)

### 🚀 Features

- **desktop:** Silent auto-update via electron-updater ([86967ca](https://github.com/machulav/accountant24/commit/86967ca))

## v0.2.2

[compare changes](https://github.com/machulav/accountant24/compare/v0.2.1...v0.2.2)

### 🚀 Features

- **desktop:** Show app version in settings ([de73d88](https://github.com/machulav/accountant24/commit/de73d88))

### 🐞 Bug Fixes

- **ci:** Silence untrusted aws/tap annotation on macos runners ([5e878c3](https://github.com/machulav/accountant24/commit/5e878c3))
- **desktop:** Full-bleed app icon artwork for macOS 26 dock rendering ([61ebaf9](https://github.com/machulav/accountant24/commit/61ebaf9))

## v0.2.1

[compare changes](https://github.com/machulav/accountant24/compare/v0.2.0...v0.2.1)

### 🚀 Features

- **ci:** Versionless release artifacts for a stable download link ([4387b58](https://github.com/machulav/accountant24/commit/4387b58))
- **desktop:** Expand anonymous analytics with funnel and usage events ([f7341a0](https://github.com/machulav/accountant24/commit/f7341a0))
- **desktop:** Rotate composer placeholder tips on new chats ([7c91685](https://github.com/machulav/accountant24/commit/7c91685))
- **desktop:** Focus composer on chat switch and add placeholder tests ([f651d65](https://github.com/machulav/accountant24/commit/f651d65))
- **desktop:** New a24 wordmark app icon ([345bdef](https://github.com/machulav/accountant24/commit/345bdef))

### 🐞 Bug Fixes

- **desktop:** Show app icon in dev mode dock ([37f5018](https://github.com/machulav/accountant24/commit/37f5018))

### 📖 Documentation

- Point download links at the latest release page ([014f41d](https://github.com/machulav/accountant24/commit/014f41d))
- Streamline quick start and add a hero download link ([da5291c](https://github.com/machulav/accountant24/commit/da5291c))

## v0.2.0

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.10...v0.2.0)

### 🚀 Features

- **desktop:** ⚠️  Native macOS desktop app ([#12](https://github.com/machulav/accountant24/pull/12))
- **ci:** Sign and notarize the desktop app release builds ([b23e849](https://github.com/machulav/accountant24/commit/b23e849))
- **ci:** Cut releases from the Release workflow button ([dca86a7](https://github.com/machulav/accountant24/commit/dca86a7))
- **desktop:** Replace first-run login screen with model onboarding ([670b7b4](https://github.com/machulav/accountant24/commit/670b7b4))

### 🐞 Bug Fixes

- Make release tap update idempotent + add --tap-only ([#13](https://github.com/machulav/accountant24/pull/13))
- Run commit-msg hook via bun run commitlint ([#15](https://github.com/machulav/accountant24/pull/15))
- **ci:** Repair desktop release build ([2a73408](https://github.com/machulav/accountant24/commit/2a73408))
- **ci:** Provide CLI tools for integration tests in checks job ([eb549c5](https://github.com/machulav/accountant24/commit/eb549c5))
- **ci:** Keep rebuild path from silently skipping build and publish ([5036f24](https://github.com/machulav/accountant24/commit/5036f24))

### 📖 Documentation

- Add FAQ page and refresh landing copy ([2bfbc93](https://github.com/machulav/accountant24/commit/2bfbc93))
- Drop duplicate intro paragraph on landing page ([6eae518](https://github.com/machulav/accountant24/commit/6eae518))
- Shorten landing page meta description ([0b28596](https://github.com/machulav/accountant24/commit/0b28596))
- Add JSON-LD structured data for site, app, and FAQ ([858533b](https://github.com/machulav/accountant24/commit/858533b))
- Optimize tagline across README, landing page, and JSON-LD ([92d922d](https://github.com/machulav/accountant24/commit/92d922d))
- Restore pre-desktop README (brew install instead of dmg) ([7f84b74](https://github.com/machulav/accountant24/commit/7f84b74))
- Adjust README and docs site to the desktop app release ([4545c5d](https://github.com/machulav/accountant24/commit/4545c5d))

### 🏡 Chore

- **release:** V0.2.0-rc.1 ([f3fd501](https://github.com/machulav/accountant24/commit/f3fd501))
- **release:** V0.2.0-rc.2 ([8f5c667](https://github.com/machulav/accountant24/commit/8f5c667))

### 🤖 CI

- Add release-candidate flow (--rc) to release script ([194ffa6](https://github.com/machulav/accountant24/commit/194ffa6))

#### ⚠️ Breaking Changes

- **desktop:** ⚠️  Native macOS desktop app ([#12](https://github.com/machulav/accountant24/pull/12))

## v0.1.10

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.9...v0.1.10)

### 🐞 Bug Fixes

- Add missing @sinclair/typebox dependency ([5dd63cb](https://github.com/machulav/accountant24/commit/5dd63cb))
- Declare typebox as direct dependency instead of @sinclair/typebox ([a717634](https://github.com/machulav/accountant24/commit/a717634))

### ♻️ Refactors

- Use framework generateDiffString instead of custom diff ([93bb047](https://github.com/machulav/accountant24/commit/93bb047))
- Register autocomplete via addAutocompleteProvider ([654e3d3](https://github.com/machulav/accountant24/commit/654e3d3))

### 📖 Documentation

- Update README with demo video, session links, and login wording ([375ec27](https://github.com/machulav/accountant24/commit/375ec27))
- Add Mintlify documentation site ([#11](https://github.com/machulav/accountant24/pull/11))

### 📦 Build

- Migrate to @earendil-works/pi-coding-agent 0.74.0 ([#9](https://github.com/machulav/accountant24/pull/9))
- Upgrade @earendil-works/pi-coding-agent to 0.79.8 ([3492e32](https://github.com/machulav/accountant24/commit/3492e32))

### 🏡 Chore

- Remove CLAUDE.md and docs symlinks ([a24af5e](https://github.com/machulav/accountant24/commit/a24af5e))
- Harden dependency workflow ([d9cc75e](https://github.com/machulav/accountant24/commit/d9cc75e))

## v0.1.9

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.8...v0.1.9)

### 📦 Build

- Refresh lockfile after dependency updates ([ef046a0](https://github.com/machulav/accountant24/commit/ef046a0))

## v0.1.8

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.7...v0.1.8)

### 🚀 Features

- Change add_transaction tool to add_transactions for batch support ([10e5452](https://github.com/machulav/accountant24/commit/10e5452))

### 🐞 Bug Fixes

- Add spacer before first user message in chat ([db107c4](https://github.com/machulav/accountant24/commit/db107c4))
- Make transaction description optional ([91b058b](https://github.com/machulav/accountant24/commit/91b058b))

### ♻️ Refactors

- Remove settings.json and models.json from scaffold ([62c33fc](https://github.com/machulav/accountant24/commit/62c33fc))
- Migrate tool imports from @sinclair/typebox to typebox ([7c5030f](https://github.com/machulav/accountant24/commit/7c5030f))

### 📖 Documentation

- Add demo ledger link to README ([36f979c](https://github.com/machulav/accountant24/commit/36f979c))

### 📦 Build

- Upgrade pi-coding-agent from 0.63.1 to 0.69.0 ([#6](https://github.com/machulav/accountant24/pull/6))
- Upgrade pi-coding-agent from 0.69.0 to 0.70.2 ([28a8714](https://github.com/machulav/accountant24/commit/28a8714))

## v0.1.7

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.6...v0.1.7)

### 🚀 Features

- Add commodities.journal to scaffold ([5353fb3](https://github.com/machulav/accountant24/commit/5353fb3))
- Use timestamp-only naming for workspace files ([0345353](https://github.com/machulav/accountant24/commit/0345353))
- Override framework terminal title with Accountant24 ([8e8427f](https://github.com/machulav/accountant24/commit/8e8427f))

### 📖 Documentation

- Add demo screenshot and session snapshot link to README ([75c8348](https://github.com/machulav/accountant24/commit/75c8348))
- Update demo screenshot ([d949130](https://github.com/machulav/accountant24/commit/d949130))
- Add git to "Why this stack" section ([df801b9](https://github.com/machulav/accountant24/commit/df801b9))

## v0.1.6

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.5...v0.1.6)

### 🚀 Features

- Show selected model in footer below input field ([1e3ec3a](https://github.com/machulav/accountant24/commit/1e3ec3a))
- **prompt:** Enforce tool priority over file tools and bash ([5012b90](https://github.com/machulav/accountant24/commit/5012b90))

### 📖 Documentation

- Streamline README structure and reorder sections ([af54bbb](https://github.com/machulav/accountant24/commit/af54bbb))

## v0.1.5

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.4...v0.1.5)

### 🐞 Bug Fixes

- Align library's getAgentDir() with workspace directory ([8caa649](https://github.com/machulav/accountant24/commit/8caa649))
- **tools:** Replace JS PDF/OCR libs with CLI tools for compiled binary ([3839ea9](https://github.com/machulav/accountant24/commit/3839ea9))

### 📖 Documentation

- Rewrite README intro and section headings for clarity ([314deed](https://github.com/machulav/accountant24/commit/314deed))

## v0.1.4

[compare changes](https://github.com/machulav/accountant24/compare/v0.1.3...v0.1.4)

### 🚀 Features

- Split file copy and text extraction into two tools ([02826c2](https://github.com/machulav/accountant24/commit/02826c2))
- Require workspace-relative paths in extract_text tool ([3d730f7](https://github.com/machulav/accountant24/commit/3d730f7))

### 🐞 Bug Fixes

- Exclude future-dated transactions from briefing and reports ([db5846b](https://github.com/machulav/accountant24/commit/db5846b))
- Suppress pdfjs-dist warnings that corrupt the TUI ([442c952](https://github.com/machulav/accountant24/commit/442c952))
- Replace whitespace with hyphens in workspace filenames ([9f9f845](https://github.com/machulav/accountant24/commit/9f9f845))

### ♻️ Refactors

- Overhaul add_transaction tags and posting params ([5da6de3](https://github.com/machulav/accountant24/commit/5da6de3))
- Rename narration to description across the codebase ([1145fbe](https://github.com/machulav/accountant24/commit/1145fbe))

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
