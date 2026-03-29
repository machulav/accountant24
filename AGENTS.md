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
