// Type augmentation for the custom matchers registered in vitest.setup.ts
// (re-adds bun:test's toStartWith / toEndWith for vitest).
import "vitest";

declare module "vitest" {
  interface Assertion<T = unknown> {
    toStartWith(expected: string): T;
    toEndWith(expected: string): T;
  }
  interface AsymmetricMatchersContaining {
    toStartWith(expected: string): unknown;
    toEndWith(expected: string): unknown;
  }
}
