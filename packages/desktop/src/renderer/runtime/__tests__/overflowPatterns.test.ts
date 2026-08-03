import { getOverflowPatterns, isContextOverflow } from "@earendil-works/pi-ai/base";
import { describe, expect, it } from "vitest";
import { isOverflowErrorMessage, OVERFLOW_PATTERNS } from "../overflowPatterns";

// overflowPatterns.ts is a verbatim copy of pi-ai's overflow detection (the
// import would drag pi-ai's generated model catalog into the renderer bundle).
// These drift guards compare the copy against the INSTALLED pi-ai on every
// test run: when a pi upgrade changes the patterns, they fail and the copy
// gets re-synced.

describe("overflowPatterns drift guard", () => {
  it("should carry exactly the installed pi-ai overflow patterns", () => {
    expect(OVERFLOW_PATTERNS.map(String)).toEqual(getOverflowPatterns().map(String));
  });

  it("should agree with pi-ai's isContextOverflow on representative error messages", () => {
    const samples = [
      // Overflow errors from the pattern list's documented examples.
      "prompt is too long: 213462 tokens > 200000 maximum",
      '413 {"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
      "Your input exceeds the context window of this model",
      "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
      "This model's maximum prompt length is 131072 but the request contains 537812 tokens",
      "Please reduce the length of the messages or completion",
      "the request exceeds the available context size, try increasing it",
      "context_length_exceeded",
      "too many tokens",
      "400 status code (no body)",
      // Non-overflow exclusions and plain errors.
      "ThrottlingException: Too many tokens, please wait before trying again.",
      "Throttling error: Too many tokens, please wait before trying again.",
      "rate limit exceeded, too many tokens",
      "Too many requests, slow down",
      "Internal server error",
      "Invalid API key",
    ];
    for (const errorMessage of samples) {
      const message = { role: "assistant", content: [], stopReason: "error", errorMessage };
      expect
        .soft(isOverflowErrorMessage(errorMessage), errorMessage)
        .toBe(isContextOverflow(message as unknown as Parameters<typeof isContextOverflow>[0]));
    }
  });
});

describe("isOverflowErrorMessage()", () => {
  it("should return true for a provider overflow error", () => {
    expect(isOverflowErrorMessage("prompt is too long: 213462 tokens > 200000 maximum")).toBe(true);
  });

  it("should return false for a throttling error that also mentions tokens", () => {
    expect(isOverflowErrorMessage("ThrottlingException: rate limit, too many tokens, please wait.")).toBe(false);
  });

  it("should return false for an unrelated error", () => {
    expect(isOverflowErrorMessage("Internal server error")).toBe(false);
  });
});
