> Keep entries in this file brief and high-level: principles and conventions, not implementation detail.

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

# UI Components

The desktop app uses the **wrapper pattern**: library components stay untouched; all customization lives in our own components.

## Structure

`packages/desktop/src/components/`:

- `shadcn/` — stock shadcn/ui components (Base UI-based). **Never edit**; add/update only via `scripts/shadcn.sh`. The whole shadcn catalog (select, tabs, card, dropdown-menu, table, …) is available on demand: `sh packages/desktop/scripts/shadcn.sh add <component>` — install before building custom UI.
- `accountant24/` — all our components: wrappers around shadcn, customized assistant-ui components, app UI.

## Rules

- Naming: kebab-case file names (`composer-model-selector.tsx`), PascalCase component names (`ComposerModelSelector`).
- Build UI/UX from stock `shadcn/` components with their default look wherever possible; customize only when absolutely necessary.
- When customization is necessary, wrap the library component with a new component in `accountant24/` — don't edit the original.
- Style with theme tokens from `src/index.css`; no hardcoded colors.
- **Match existing shadcn idioms by default.** When building custom UI, reuse the closest existing `shadcn/` component's token pattern rather than hand-rolling ad-hoc styles.
- **No speculative style overrides.** Never add custom classes/styles to work around a behavior before finding its root cause — fix the cause instead. Add an override only when verified necessary (reproduce the problem, confirm the override is the minimal fix), and comment why it exists.
- Dark theme follows the OS: `src/lib/systemTheme.ts` toggles the `.dark` class globally — no per-component theme handling.

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
- **Integration** (`*.integration.test.ts(x)`) — a flow across modules. Two shapes: main-process handlers over a real temp workspace (`electron/main/__tests__/tmpWorkspace.ts`), or renderer flows over a fake `window.api` bridge (`src/test/fakeApi.ts`). Use for user flows and cross-boundary wiring.
- **E2E smoke** (Playwright-Electron, `packages/desktop/e2e/`, `npm run e2e`) — the real app on a few critical happy paths, with the pi agent stubbed. Guards wiring (preload allowlist, IPC, build), not logic. Keep it tiny.

## Best practices per tier

- **Unit** — mock only at fs/child_process; keep functions small and pure.
- **Component** — assert on roles/text, not classes or DOM structure; use the shared `src/test/jsdomPolyfills.ts` preamble; drive interaction with `@testing-library/user-event`.
- **Integration** — assert **both** the resulting UI/state **and** the exact IPC calls (`fakeApi.calls` / invoked main handlers). Use a temp `ACCOUNTANT24_HOME`, never a global `node:fs` mock.
- **E2E** — deterministic and small; stub the agent (no real LLM/network); leave logic coverage to the lower tiers.

## Coverage

- **Target: pragmatic 100%.** Thresholds are enforced in `vitest.config.ts` and **only ratchet up, never down**.
- **Excluded** (not worth testing): stock `shadcn/` components (never edited), barrel `index.ts` files, entry/glue, generated/template assets, type-only files. Everything else — business logic and our own components — is expected to be covered.

## Covering new work

- Every new feature or module ships **in the same PR** with tests at **all applicable tiers**: pure logic → unit; new/changed component → component; new user flow → integration; new critical happy path → an E2E line.
- A change must not drop coverage below the gate.
- A bug fix ships with a regression test that **fails before** the fix and passes after.
