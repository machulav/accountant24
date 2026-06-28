import { expect } from "vitest";

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
