# Testing

## Philosophy

Tests are **specifications**, not verifications of current code. Write tests that describe how the business logic _should_ work — independently of the implementation. If the code has a bug, the test must catch it, not confirm it.

## Rules

- **Derive expected values from the specification, never from the code.** Hardcode expected outputs. Never re-derive them using the same formula as production code.
- **Test behavior through public interfaces.** Assert on outputs and observable side-effects, not internal implementation details. If you refactor internals without changing behavior, zero tests should break.
- **Only mock at I/O boundaries** (network, database, filesystem). Never mock the unit under test.
- **Cover all paths:** happy path, error paths, boundary values (zero, empty, null, max), and edge cases — each as a separate focused test.
- **Mutation mindset:** before finalizing, ask "would this test fail if I changed `>` to `>=` or `+` to `-` in the code?" If not, strengthen the assertions.
- Prefer small, testable functions. Split large tests into smaller ones. Target 100% coverage.

# System Prompt

The agent's behavior is controlled by two layers. Each has distinct responsibilities:

## Layer 1: Tool Parameter Descriptions (`src/core/tools/*.ts`)

**Job:** Constrain *parameter values* at call time.

- Define valid formats, examples, and edge-case defaults (e.g., payee = "Unknown")
- Descriptions are injected into the LLM context alongside the tool schema
- Cannot express conditional logic or workflow — only what a parameter IS, not when to ask for it
- Keep descriptions concise but specific about edge cases

## Layer 2: System Prompt (`src/core/agent/system-prompt.ts`)

**Job:** Define the *decision-making workflow* — when to call tools, when to ask the user, when to skip steps.

- ADDING TRANSACTIONS section: the decision tree for gathering info → querying → adding
- Examples: show the agent concrete traces for key behavioral paths
- Memory/session context: injected dynamically (today's date, facts, accounts, payees)
- Cannot constrain parameter values at call time — that's the tool description's job

## When to update which layer

| Scenario | Update |
|----------|--------|
| Agent passes wrong value to a tool parameter | Tool parameter description |
| Agent calls a tool when it shouldn't (or vice versa) | System prompt workflow |
| Agent doesn't ask user when it should | System prompt workflow |
| Agent picks wrong default for a field | Tool parameter description |
| Agent follows wrong sequence of steps | System prompt workflow + examples |

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
