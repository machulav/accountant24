# Architecture

Project-wide architecture for Accountant24. For the testing philosophy and conventions,
see `AGENTS.md`.

## What this is

Accountant24 is a local-first desktop app: an AI agent for personal finance that stores
everything as plain-text [hledger](https://hledger.org) journals in `~/Accountant24`,
versioned with git. The LLM understands natural language; hledger keeps the accounting
math honest; git makes every change traceable; [pi](https://github.com/badlogic/pi-mono)
orchestrates sessions, tools, and LLM communication.

## Commands

Run from the repo root (npm workspaces).

| Task | Command |
| --- | --- |
| Run the desktop app in dev | `npm start` (bundles the extension, then `electron-vite dev`) |
| Run the agent standalone in a terminal | `npm run start:agent` |
| Run all tests | `npm test` (vitest) |
| Run one test file | `npx vitest run packages/pi-extension/src/ledger/__tests__/query.test.ts` |
| Watch one test | `npx vitest packages/pi-extension/src/ledger/__tests__/query.test.ts` |
| Filter by name | `npx vitest run -t "should reject absolute paths"` |
| Lint / format / autofix | `npm run lint` / `npm run format` / `npm run check` (Biome) |
| Typecheck (all packages) | `npm run typecheck` |
| Full gate (audit + biome + tsc + coverage) | `npm run verify` |
| Run the eval suite | `npm run eval` |
| Build for macOS (.dmg) | `npm run dist` |

Formatting/linting is Biome (see `biome.json`), not ESLint/Prettier. Commits are validated
by commitlint (conventional commits, 72-char header); `pre-commit` runs `biome check
--write`. Both are wired via `simple-git-hooks`.

## Workspaces

Three workspaces under `packages/`:

- **`pi-extension`** -- the domain logic. A pi extension that registers custom tools, slash
  commands, workspace scaffolding, and the system prompt. This is where nearly all business
  logic lives and where most tests are. It has no UI and no Electron dependency.
- **`desktop`** -- the Electron app. Renders a React UI (assistant-ui) and hosts the pi
  agent. Contains no finance/accounting logic.
- **`evals`** -- an LLM eval harness (`packages/evals/cases/*.jsonl` cases, graded by a
  rubric) that runs the real agent against scripted prompts.

### How the pieces connect (the key mental model)

1. `scripts/bundle-extension.ts` (esbuild) bundles `packages/pi-extension/src/entry.ts`
   into a single self-contained `packages/desktop/resources/accountant24-extension.js`.
   pi's virtual modules (`@earendil-works/pi-*`, `typebox`) are **externalized** -- they
   resolve against `node_modules` at load time. `.md`/`.journal`/`.gitignore` templates are
   inlined as text. This bundle step runs before every `start`/`build`.

2. The desktop **main process** (`packages/desktop/electron/main/agent.ts`) spawns pi as a
   child process: `pi --mode rpc --no-extensions --no-skills -e <bundle>`, run via
   **Electron-as-Node** (`ELECTRON_RUN_AS_NODE=1`) rather than a compiled pi binary. It
   bridges the child's JSONL stdio to the renderer over IPC: each stdout line ->
   `agent-event`; renderer `agent_send` -> one JSON command to stdin.

3. `packages/desktop/electron/main/pi.ts` runs pi's **auth / models / sessions** in-process
   via the pi SDK (`AuthStorage`, `ModelRegistry`, `SessionManager`) -- stock pi has no
   headless auth -- and exposes them over IPC. These read/write `auth.json` + `models.json`
   in the workspace, the same files the agent child reads.

4. `packages/desktop/electron/main/env.ts` builds the agent child's environment: sets
   `ACCOUNTANT24_HOME` (the workspace), prepends the vendored native-tool dir to `PATH`
   (hledger, pdftotext, pdftocairo, tesseract), and points `TESSDATA_PREFIX` at the OCR
   data. The renderer builds all UI from the RPC event stream -- the extension registers
   **no** pi TUI customization.

5. The extension (`packages/pi-extension/src/extension.ts`) is the composition root: it
   registers tools and commands, scaffolds the workspace on `session_start`, and on
   `before_agent_start` injects dynamic context (today's date, memory, accounts, payees,
   tags, and the enabled tools' snippets) into the system prompt.

## The workspace (`~/Accountant24`, or `ACCOUNTANT24_HOME`)

Resolved in `packages/pi-extension/src/config.ts`. Contains `ledger/` (hledger journals),
`files/` (archived source documents, organized by date), `memory.md` (persistent user
preferences the agent learns), plus `auth.json`, `models.json`, and `sessions/`. The whole
dir is a git repo the agent auto-commits to. Inside `ledger/`, transactions live in
per-month files `ledger/YYYY/MM.journal`, all pulled in by `ledger/main.journal` via
`include` directives (alongside `accounts.journal`, `commodities.journal`,
`prices.journal`).

## Custom agent tools

Registered in `packages/pi-extension/src/extension.ts`; each tool definition lives in
`packages/pi-extension/src/tools/` and delegates to logic in `ledger/`, `git/`, or `files/`.

| Tool | Purpose |
| --- | --- |
| `query` | Read the ledger via hledger reports (balance, register, income statement, ...). |
| `add_transactions` | Write double-entry transactions, auto-routed to monthly files. |
| `modify_transactions` | Query-targeted bulk edits: change one field (account or payee) on every match. |
| `validate` | Run `hledger check --strict` over the whole ledger. |
| `extract_text` | PDF/image to text via pdftotext / OCR. |
| `update_memory` | Persist learned user preferences to `memory.md`. |
| `commit_and_push` | Commit all workspace changes and push to the remote. |

## `modify_transactions`

Backend: `packages/pi-extension/src/ledger/modify.ts`. Runs a standard hledger query to
target transactions, then changes one named `field` on every match:

- `field: "account"` -- move postings in `from_account` (exact match) into `new_value`.
- `field: "payee"` -- rename the payee `from_payee` (exact match) to `new_value`; matched
  transactions whose payee differs are left untouched.

The `field` enum is limited to values that are safe as surgical text replacements. `amount`
is excluded (changing one posting unbalances the entry) and `date` is excluded (it decides
which monthly file a transaction lives in, so changing it means moving the transaction, not
editing text); more text-safe fields (`description`, `status`, `code`) can be added later.

Design notes:

- **Query is an argv array** (`["payee:EDEKA", "acct:expenses:uncategorized"]`), not a
  string. Each element is passed verbatim as one argv token to hledger via `spawnText`, so
  a term with spaces (`desc:whole foods`) is a single element needing no quoting, and there
  is no brittle string tokenizer. Terms starting with `-` are rejected (option injection).
- **Discovery** uses `hledger print -f main.journal <...query> -O json`; each transaction's
  `tsourcepos` gives the source file and start line.
- **Editing is surgical, in-place text** -- not a re-render via hledger. Only the affected
  account or payee text changes; amounts, sibling postings, tags, comments, alignment
  (the amount's original column), posting status markers, virtual/balanced-virtual
  brackets, and CRLF line endings are all preserved.
- hledger query terms are **case-insensitive regex substrings** (`payee:DB` also matches
  `GOLDBACH`), so callers are guided to anchor patterns (`payee:^EDEKA$`). Because a fuzzy
  query is easy to write, `field: "payee"` also requires an exact `from_payee` (mirroring
  `from_account`) and only renames transactions whose payee matches it -- the query narrows,
  the `from_*` value decides. `new_value` is rejected if it contains characters that are
  structural in journal syntax (tab/double-space for accounts, `|`/`;` for payees).

## Ledger write-safety model

All writers (`ledger/transactions.ts`, `ledger/modify.ts`) share these invariants:

- **No shell.** External tools run through `spawnText` (`packages/pi-extension/src/spawn.ts`),
  which uses `child_process.spawn` with an argv array. Never build a shell command by string
  interpolation.
- **Confined paths.** Agent-supplied paths go through the workspace guards:
  `resolveWorkspacePath` (`files/paths.ts`) rejects absolute and `~` paths, and
  `resolveSafePath` (`ledger/paths.ts`) rejects anything escaping the base dir. hledger
  `tsourcepos` paths are re-confined the same way before editing.
- **Validate every write.** After writing, `hledger check --strict` runs over `main.journal`.

### Serialization: `executionMode: "sequential"`

Every ledger-writing tool (`add_transactions`, `modify_transactions`) is registered with
`executionMode: "sequential"`. When an assistant turn requests multiple tool calls at once,
pi's agent loop checks whether *any* call in that batch targets a sequential tool; if so, the
whole batch runs one call at a time instead of concurrently. That keeps each tool's
non-atomic read/edit/write/validate cycle from interleaving with another's on shared monthly
files -- otherwise a race could lose edits, let one call's rollback clobber another's writes,
or validate against a half-written ledger. This only needs to hold within a single agent
loop: separate turns are already sequential (the loop awaits one turn's results before
starting the next), and there is no cross-process file locking -- all journal writes happen
in the single agent child process, with git as the backstop for anything else.

### Atomicity and rollback

- `modify_transactions` is **atomic**, via a `JournalEditSession`
  (`ledger/edit-session.ts`): a buffered editor that snapshots each file's original content
  on first touch, flushes only changed files, and on failure restores exactly those files to
  the snapshot. `dry_run` runs the full path (including validation) then always restores,
  leaving the disk byte-for-byte unchanged. The session only edits files that already exist
  (file creation/deletion is not modeled yet).
- `add_transactions` is **not yet** atomic on validation failure -- it leaves the written
  (invalid) transactions on disk and reports the error. Migrating it onto `JournalEditSession`
  (which first needs file-creation support) is a known follow-up.
- Crash-atomicity (process killed mid multi-file write) is intentionally not handled in
  code; git is the recovery backstop (partial writes show up in `git status` / `git diff`).
