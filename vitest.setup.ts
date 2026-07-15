import { expect } from "vitest";

// jest-dom DOM matchers (toBeInTheDocument, toBeDisabled, …) for component tests.
// Only load in a DOM environment — this setup file also runs for node-env tests,
// where document is undefined and the matchers would be meaningless.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
}

// bun:test shipped toStartWith/toEndWith; vitest doesn't. Re-add them so the
// migrated tests keep working unchanged.
expect.extend({
  toStartWith(received: string, expected: string) {
    const pass = typeof received === "string" && received.startsWith(expected);
    return {
      pass,
      message: () =>
        `expected ${this.utils.printReceived(received)} to ${pass ? "not " : ""}start with ${this.utils.printExpected(expected)}`,
    };
  },
  toEndWith(received: string, expected: string) {
    const pass = typeof received === "string" && received.endsWith(expected);
    return {
      pass,
      message: () =>
        `expected ${this.utils.printReceived(received)} to ${pass ? "not " : ""}end with ${this.utils.printExpected(expected)}`,
    };
  },
});
