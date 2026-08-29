> This file is a high-level overview and guidance, not a manual. Whenever you add or change a rule here, keep it brief, conceptual, and clearly written: principles and conventions, never implementation detail. The code is the source of truth for the details, and the agent is trusted to decide the specifics.

# Tech Stack

## Shared

- npm workspaces — monorepo
- TypeScript
- Biome — lint + format
- Vitest — tests

## packages/desktop

The Electron desktop app:

- Electron
- React
- electron-vite — build
- electron-builder — packaging
- shadcn/ui (Base UI-based) — UI components
- Tailwind CSS — styling
- assistant-ui (`@assistant-ui/react`) — chat UI
- pi coding agent (`@earendil-works/pi-coding-agent`) — agent

# Architecture

`packages/desktop` follows the standard electron-vite layout (`src/main`, `src/preload`, `src/renderer`), plus one addition:

- `src/main/` — Electron main process: window, IPC handlers, the workspace (location `cli.ts` + `env.ts`, `migrations/`, setup `workspace.ts`), the agent (`agent/`), LLM provider connections (`llm-providers/`), vendored binaries (hledger, uv).
- `src/main/agent/plugins-defaults.ts` — the plugins a new workspace starts with, listed as repositories and installed from the marketplace on first launch. The app bundles no plugin of its own.
- `src/main/agent/` — the chat runtime: the IPC router plus `host/`, which runs in a single agent-host utilityProcess hosting one pi SDK session per chat. Nothing in `host/` may import Electron APIs.
- `src/main/llm-providers/` — LLM provider auth, OAuth login, models, Ollama. `llm-providers/` and `agent/` never import each other; their only interface is the workspace files (`auth.json`/`models.json`).
- `src/preload/` — the `window.api` bridge; every IPC channel must be allowlisted here.
- `src/renderer/` — the React app, sandboxed; reaches main only through `window.api` (typed wrappers in `rpc/api.ts`).
- `src/shared/` — IPC payload types used by both main and renderer (and the agent host). Types only, imported with `import type` from both sides; never add runtime code here.

The agent itself is `packages/pi-extension`, bundled and loaded into the agent-host utilityProcess that main forks lazily (one process for all chats).

# Workspace

One folder holds all user data. It is resolved once per launch (`--workspace` flag > `ACCOUNTANT24_WORKSPACE` > `~/.accountant24`) and exported as `ACCOUNTANT24_WORKSPACE` to every child process, so every part of the app agrees on it.

## Migrations

A change to an existing workspace's layout or contents ships as a numbered migration in `src/main/migrations/`, applied once per workspace at launch before anything reads the folder.

- One file per change; append it to the list; never edit a shipped one.
- Idempotent, confined to the given workspace, failing loudly on anything unexpected (a failed migration aborts startup).
- Tested over a real temp directory.

# System Prompt

The agent's system prompt is `packages/pi-extension/src/system-prompt/system.md` (copied to desktop resources at build time; runtime data blocks like `<memory>` and `<accounts>` are appended per turn by the extension).

- Keep it short: every line is sent on every turn. Add a rule only for observed behavior a shorter rule didn't fix.
- Group rules by topic in Markdown `#` sections; a topic's rules live in exactly one section, never duplicated elsewhere. `# Ground rules` holds the important cross-cutting rules the agent must always follow; a rule that fits neither a topic nor Ground rules goes in `# Other rules` — never force-fit a rule into a section.
- Severity is carried by wording, not by section: "Never"/"Always"/"Only" for absolute rules, "prefer"/"when" for judgment calls.
- Markdown headers carry authored instructions; XML tags carry runtime-injected data (`<memory>`, `<accounts>`, `<tools>`, …). Data blocks contain only verbatim data; guidance about a block lives in its matching Markdown section (`# Memory` for `<memory>`).
- Rules the agent must not be able to break get code enforcement (extension hooks), with the prompt rule on top.
- Prefer positive phrasing: say what to do instead alongside every prohibition.

# UI Components

The desktop app uses the **wrapper pattern**: library components stay untouched; all customization lives in our own components.

## Structure

`packages/desktop/src/renderer/components/`:

- `shadcn/` — stock shadcn/ui components (Base UI-based). **Never edit**; add/update only via `scripts/shadcn.sh`. The whole shadcn catalog (select, tabs, card, dropdown-menu, table, …) is available on demand: `sh packages/desktop/scripts/shadcn.sh add <component>` — install before building custom UI.
- `reui/` — vendored ReUI registry components (Base UI flavor; today the data grid on TanStack Table v9). **Never edit** beyond mechanical vendoring transforms (import aliases, unused-symbol strips); re-vendor from the reui.io registry JSON to update. `icon-placeholder.tsx` is the one local file: a lucide adapter for the registry's icon indirection.
- `accountant24/` — all our components: wrappers around shadcn, customized assistant-ui components, app UI.

## Rules

- Naming: kebab-case file names (`composer-model-selector.tsx`), PascalCase component names (`ComposerModelSelector`).
- Build UI/UX from stock `shadcn/` components with their default look wherever possible; customize only when absolutely necessary.
- When customization is necessary, wrap the library component with a new component in `accountant24/` — don't edit the original.
- Style with theme tokens from `src/renderer/index.css`; no hardcoded colors.
- **Match existing shadcn idioms by default.** When building custom UI, reuse the closest existing `shadcn/` component's token pattern rather than hand-rolling ad-hoc styles.
- **No speculative style overrides.** Never add custom classes/styles to work around a behavior before finding its root cause — fix the cause instead. Add an override only when verified necessary (reproduce the problem, confirm the override is the minimal fix), and comment why it exists.
- Dark theme follows the OS: `src/renderer/lib/systemTheme.ts` toggles the `.dark` class globally — no per-component theme handling.

# Testing

## Philosophy

Tests are **specifications**, not verifications of current code. Write tests that describe how the business logic _should_ work — independently of the implementation. If the code has a bug, the test must catch it, not confirm it.

## Rules

- **Derive expected values from the specification, never from the code.** Hardcode expected outputs. Never re-derive them using the same formula as production code.
- **Test behavior through public interfaces.** Assert on outputs and observable side-effects, not internal implementation details. If you refactor internals without changing behavior, zero tests should break.
- **Only mock at I/O boundaries** (network, database, filesystem). Never mock the unit under test.
- **Cover all paths:** happy path, error paths, boundary values (zero, empty, null, max), and edge cases — each as a separate focused test.
- **Mutation mindset:** before finalizing, ask "would this test fail if I changed `>` to `>=` or `+` to `-` in the code?" If not, strengthen the assertions.
- **Prefer small, testable functions:** split large tests into smaller ones. Target 100% coverage.
- **Cover each new feature with tests:** when a new feature is added, add a test for it.

## Structure

- Place tests in `__tests__/` folders next to the code. File name: `<source>.test.ts`.
- Group all tests for a function under one `describe()`. Use nested `describe()` blocks for logical grouping.
- Name tests as behavioral specs: `should [expected outcome] when [condition]`. Example:

  ```ts
  describe("calculateTotal()", () => {
    it("should return 36 when price=10, quantity=3, tax=0.2", () => {
      expect(calculateTotal(10, 3, 0.2)).toBe(36);
    });
  });
  ```

## Test types

Four tiers, all on Vitest (`npm test`); the first three run in CI on every PR.

- **Unit** (`node` env) — pure logic: formatters, parsers, validators, arg-builders, reducers. The default and largest tier. Reach for it for any pure function.
- **Component** (`jsdom` + Testing Library) — a single React component in isolation. Mock the IPC layer with `vi.mock("@/rpc/api", …)`. Use for render/interaction behavior of one component.
- **Integration** (`*.integration.test.ts(x)`) — a flow across modules. Two shapes: main-process handlers over a real temp workspace (`src/main/__tests__/tmpWorkspace.ts`), or renderer flows over a fake `window.api` bridge (`src/renderer/test/fakeApi.ts`). Use for user flows and cross-boundary wiring.
- **E2E smoke** (Playwright-Electron, `packages/desktop/e2e/`, `npm run e2e`) — the real app on a few critical happy paths, with the pi agent stubbed. Guards wiring (preload allowlist, IPC, build), not logic. Keep it tiny.

## Best practices per tier

- **Unit** — mock only at fs/child_process; keep functions small and pure.
- **Component** — assert on roles/text, not classes or DOM structure; use the shared `src/renderer/test/jsdomPolyfills.ts` preamble; drive interaction with `@testing-library/user-event`.
- **Integration** — assert **both** the resulting UI/state **and** the exact IPC calls (`fakeApi.calls` / invoked main handlers). Use a temp `ACCOUNTANT24_WORKSPACE`, never a global `node:fs` mock.
- **E2E** — deterministic and small; stub the agent (no real LLM/network); leave logic coverage to the lower tiers.
- **Running the app** (e2e, manual smoke runs, the verify skill, a second dev instance) — never against the real workspace; always create a fresh test workspace and launch on it (`--workspace <temp dir>` or `ACCOUNTANT24_WORKSPACE`), delete it afterwards.

## Coverage

- **Target: pragmatic 100%.** Thresholds are enforced in `vitest.config.ts` and **only ratchet up, never down**.
- **Excluded** (not worth testing): stock `shadcn/` components (never edited), barrel `index.ts` files, entry/glue, generated/template assets, type-only files. Everything else — business logic and our own components — is expected to be covered.

## Covering new work

- Every new feature or module ships **in the same PR** with tests at **all applicable tiers**: pure logic → unit; new/changed component → component; new user flow → integration; new critical happy path → an E2E line.
- A change must not drop coverage below the gate.
- A bug fix ships with a regression test that **fails before** the fix and passes after.

# Pull Requests

- Title: Conventional Commit style matching the main commit subject; the subject is the user-visible outcome, written for the changelog.
- Body: a short, flat bullet list of what changed, and nothing else. One change per bullet, imperative phrasing ("Replace …", "Block …", "Show …"), code identifiers in backticks.
- What, never why: no motivation, strategy, or design discussion in the body.
- No issue links or tracker references; the branch name links the issue automatically.
- No AI attribution or "generated with" footers in commits or PR descriptions.
