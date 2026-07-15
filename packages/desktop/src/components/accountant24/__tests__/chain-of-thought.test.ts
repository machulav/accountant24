import { describe, expect, it } from "vitest";
import { chainLabel, splitReasoningSections, turnDurationMs } from "../chain-of-thought";

const at = (ms: number) => new Date(ms);

describe("turnDurationMs()", () => {
  it("should return the span from the preceding user message to the assistant message", () => {
    const messages = [
      { id: "u1", role: "user", createdAt: at(10_000) },
      { id: "a1", role: "assistant", createdAt: at(17_000) },
    ];
    expect(turnDurationMs(messages[1] as { id: string; createdAt?: Date }, messages)).toBe(7000);
  });

  it("should skip non-user messages when walking back to the turn start", () => {
    const messages = [
      { id: "u1", role: "user", createdAt: at(10_000) },
      { id: "a1", role: "assistant", createdAt: at(12_000) },
      { id: "a2", role: "assistant", createdAt: at(20_000) },
    ];
    expect(turnDurationMs(messages[2] as { id: string; createdAt?: Date }, messages)).toBe(10_000);
  });

  it("should use the closest preceding user message in multi-turn threads", () => {
    const messages = [
      { id: "u1", role: "user", createdAt: at(0) },
      { id: "a1", role: "assistant", createdAt: at(5_000) },
      { id: "u2", role: "user", createdAt: at(60_000) },
      { id: "a2", role: "assistant", createdAt: at(65_000) },
    ];
    expect(turnDurationMs(messages[3] as { id: string; createdAt?: Date }, messages)).toBe(5000);
  });

  it("should return null when there is no user message before the assistant message", () => {
    const messages = [{ id: "a1", role: "assistant", createdAt: at(20_000) }];
    expect(turnDurationMs(messages[0] as { id: string; createdAt?: Date }, messages)).toBeNull();
  });

  it("should return null when the assistant message has no createdAt", () => {
    const messages = [
      { id: "u1", role: "user", createdAt: at(10_000) },
      { id: "a1", role: "assistant" },
    ];
    expect(turnDurationMs(messages[1] as { id: string; createdAt?: Date }, messages)).toBeNull();
  });

  it("should return null when the preceding user message has no createdAt", () => {
    const messages = [
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant", createdAt: at(20_000) },
    ];
    expect(turnDurationMs(messages[1] as { id: string; createdAt?: Date }, messages)).toBeNull();
  });

  it("should return null when the end timestamp is before the start (inconsistent clock)", () => {
    const messages = [
      { id: "u1", role: "user", createdAt: at(30_000) },
      { id: "a1", role: "assistant", createdAt: at(20_000) },
    ];
    expect(turnDurationMs(messages[1] as { id: string; createdAt?: Date }, messages)).toBeNull();
  });

  it("should return null when the message is not part of the list", () => {
    const messages = [{ id: "u1", role: "user", createdAt: at(10_000) }];
    expect(turnDurationMs({ id: "ghost", createdAt: at(20_000) }, messages)).toBeNull();
  });

  it("should return 0 when both timestamps are equal", () => {
    const messages = [
      { id: "u1", role: "user", createdAt: at(10_000) },
      { id: "a1", role: "assistant", createdAt: at(10_000) },
    ];
    expect(turnDurationMs(messages[1] as { id: string; createdAt?: Date }, messages)).toBe(0);
  });
});

describe("chainLabel()", () => {
  it("should return 'Working' while active regardless of duration", () => {
    expect(chainLabel(true, 5000, 3)).toBe("Working");
  });

  it("should return 'Worked for 6m 23s' when duration is 383000ms", () => {
    expect(chainLabel(false, 383_000, 3)).toBe("Worked for 6m 23s");
  });

  it("should return 'Worked for <1s' when duration is 0", () => {
    expect(chainLabel(false, 0, 3)).toBe("Worked for <1s");
  });

  it("should fall back to 'Worked through 1 step' (singular) when duration is unknown", () => {
    expect(chainLabel(false, null, 1)).toBe("Worked through 1 step");
  });

  it("should fall back to 'Worked through 3 steps' (plural) when duration is unknown", () => {
    expect(chainLabel(false, null, 3)).toBe("Worked through 3 steps");
  });
});

describe("splitReasoningSections()", () => {
  it("should keep a title with its body as one section", () => {
    expect(splitReasoningSections("**Planning the query**\n\nI need to check the ledger.")).toEqual([
      "**Planning the query**\n\nI need to check the ledger.",
    ]);
  });

  it("should split concatenated title-only blocks into one section each", () => {
    expect(splitReasoningSections("**Planning**\n\n**Assessing overdue bills**\n\n**Classifying results**")).toEqual([
      "**Planning**",
      "**Assessing overdue bills**",
      "**Classifying results**",
    ]);
  });

  it("should attach each body to its preceding title when sections have bodies", () => {
    expect(splitReasoningSections("**First**\n\nbody one\n\n**Second**\n\nbody two")).toEqual([
      "**First**\n\nbody one",
      "**Second**\n\nbody two",
    ]);
  });

  it("should keep plain prose without title lines as a single section", () => {
    expect(splitReasoningSections("just thinking out loud\n\nmore thoughts")).toEqual([
      "just thinking out loud\n\nmore thoughts",
    ]);
  });

  it("should not split on a paragraph that merely starts with bold text", () => {
    expect(splitReasoningSections("**Planning**\n\n**Note:** details follow here")).toEqual([
      "**Planning**\n\n**Note:** details follow here",
    ]);
  });

  it("should keep prose before the first title as its own leading section", () => {
    expect(splitReasoningSections("some intro\n\n**Title**\n\nbody")).toEqual(["some intro", "**Title**\n\nbody"]);
  });

  it("should drop a blank leading chunk when the text starts with a blank line", () => {
    expect(splitReasoningSections("\n\n**Title**")).toEqual(["**Title**"]);
  });

  it("should return no sections for an empty string (encrypted CoT with no summary)", () => {
    expect(splitReasoningSections("")).toEqual([]);
  });

  it("should return no sections for whitespace-only text", () => {
    expect(splitReasoningSections("\n\n  ")).toEqual([]);
  });
});
