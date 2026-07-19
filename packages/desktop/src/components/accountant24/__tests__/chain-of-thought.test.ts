import { describe, expect, it } from "vitest";
import { chainLabel, cycleDurationMs, precedingUserTimestampMs, splitReasoningSections } from "../chain-of-thought";

const at = (ms: number) => new Date(ms);

describe("precedingUserTimestampMs()", () => {
  it("should return the closest preceding user message's timestamp", () => {
    const messages = [
      { id: "u1", role: "user", createdAt: at(10_000) },
      { id: "a1", role: "assistant", createdAt: at(17_000) },
    ];
    expect(precedingUserTimestampMs("a1", messages)).toBe(10_000);
  });

  it("should skip non-user messages when walking back", () => {
    const messages = [
      { id: "u1", role: "user", createdAt: at(10_000) },
      { id: "a1", role: "assistant", createdAt: at(12_000) },
      { id: "a2", role: "assistant", createdAt: at(20_000) },
    ];
    expect(precedingUserTimestampMs("a2", messages)).toBe(10_000);
  });

  it("should use the closest preceding user message in multi-turn threads", () => {
    const messages = [
      { id: "u1", role: "user", createdAt: at(0) },
      { id: "a1", role: "assistant", createdAt: at(5_000) },
      { id: "u2", role: "user", createdAt: at(60_000) },
      { id: "a2", role: "assistant", createdAt: at(65_000) },
    ];
    expect(precedingUserTimestampMs("a2", messages)).toBe(60_000);
  });

  it("should return null when there is no user message before the assistant message", () => {
    const messages = [{ id: "a1", role: "assistant", createdAt: at(20_000) }];
    expect(precedingUserTimestampMs("a1", messages)).toBeNull();
  });

  it("should return null when the preceding user message has no createdAt", () => {
    const messages = [
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant", createdAt: at(20_000) },
    ];
    expect(precedingUserTimestampMs("a1", messages)).toBeNull();
  });

  it("should return null when the message is not part of the list", () => {
    const messages = [{ id: "u1", role: "user", createdAt: at(10_000) }];
    expect(precedingUserTimestampMs("ghost", messages)).toBeNull();
  });
});

describe("cycleDurationMs()", () => {
  it("should span from the user message to the turn of the part after the group for a single cycle", () => {
    // user(10s) → turn1 [thinking, toolCall](11s) → toolResult(14s) → turn3 [thinking, text](15s)
    const piMessages = [
      { role: "user", timestamp: 10_000 },
      { role: "assistant", timestamp: 11_000 },
      { role: "toolResult", timestamp: 14_000 },
      { role: "assistant", timestamp: 15_000 },
    ];
    const parts = [
      { parentId: "pi-step:1" },
      { parentId: "pi-step:1" },
      { parentId: "pi-step:3" },
      { parentId: "pi-step:3" }, // answer text ending the cycle
    ];
    expect(cycleDurationMs({ parts, startIndex: 0, endIndex: 2, piMessages, turnStartMs: 10_000 })).toBe(5_000);
  });

  it("should measure each cycle separately when one message holds two chain groups", () => {
    // user(0) → turn1 [thinking, text](1s) → turn2 [thinking, toolCall](20s)
    // → toolResult(25s) → turn4 [text](26s)
    const piMessages = [
      { role: "user", timestamp: 0 },
      { role: "assistant", timestamp: 1_000 },
      { role: "assistant", timestamp: 20_000 },
      { role: "toolResult", timestamp: 25_000 },
      { role: "assistant", timestamp: 26_000 },
    ];
    const parts = [
      { parentId: "pi-step:1" }, // reasoning — cycle 1
      { parentId: "pi-step:1" }, // answer text
      { parentId: "pi-step:2" }, // reasoning — cycle 2
      { parentId: "pi-step:2" }, // tool call — cycle 2
      { parentId: "pi-step:4" }, // final answer text
    ];
    // Cycle 1: user (0) → turn of the first answer text (1s).
    expect(cycleDurationMs({ parts, startIndex: 0, endIndex: 0, piMessages, turnStartMs: 0 })).toBe(1_000);
    // Cycle 2: its own turn start (20s) → turn of the final text (26s) — NOT
    // the full 26s span from the user message.
    expect(cycleDurationMs({ parts, startIndex: 2, endIndex: 3, piMessages, turnStartMs: 0 })).toBe(6_000);
  });

  it("should end at the last trailing toolResult when the group ends the message", () => {
    const piMessages = [
      { role: "user", timestamp: 0 },
      { role: "assistant", timestamp: 5_000 },
      { role: "toolResult", timestamp: 8_000 },
      { role: "toolResult", timestamp: 9_500 },
    ];
    const parts = [{ parentId: "pi-step:1" }, { parentId: "pi-step:1" }, { parentId: "pi-step:1" }];
    expect(cycleDurationMs({ parts, startIndex: 0, endIndex: 2, piMessages, turnStartMs: 0 })).toBe(9_500);
  });

  it("should return null when the group ends the message with no trailing toolResult", () => {
    const piMessages = [
      { role: "user", timestamp: 0 },
      { role: "assistant", timestamp: 5_000 },
    ];
    const parts = [{ parentId: "pi-step:1" }];
    expect(cycleDurationMs({ parts, startIndex: 0, endIndex: 0, piMessages, turnStartMs: 0 })).toBeNull();
  });

  it("should not use a later user message as the end anchor", () => {
    const piMessages = [
      { role: "user", timestamp: 0 },
      { role: "assistant", timestamp: 5_000 },
      { role: "user", timestamp: 99_000 },
    ];
    const parts = [{ parentId: "pi-step:1" }];
    expect(cycleDurationMs({ parts, startIndex: 0, endIndex: 0, piMessages, turnStartMs: 0 })).toBeNull();
  });

  it("should return null when the part after the group has an unparseable parentId", () => {
    const piMessages = [
      { role: "user", timestamp: 0 },
      { role: "assistant", timestamp: 5_000 },
    ];
    const parts = [{ parentId: "pi-step:1" }, { parentId: "not-a-step" }];
    expect(cycleDurationMs({ parts, startIndex: 0, endIndex: 0, piMessages, turnStartMs: 0 })).toBeNull();
  });

  it("should return null when a later cycle's first part has no parentId", () => {
    const piMessages = [
      { role: "user", timestamp: 0 },
      { role: "assistant", timestamp: 5_000 },
      { role: "assistant", timestamp: 9_000 },
    ];
    const parts = [{ parentId: "pi-step:1" }, { parentId: "pi-step:1" }, {}, { parentId: "pi-step:2" }];
    expect(cycleDurationMs({ parts, startIndex: 2, endIndex: 2, piMessages, turnStartMs: 0 })).toBeNull();
  });

  it("should return null when the anchor pi message has no timestamp", () => {
    const piMessages = [{ role: "user", timestamp: 0 }, { role: "assistant", timestamp: 5_000 }, { role: "assistant" }];
    const parts = [{ parentId: "pi-step:1" }, { parentId: "pi-step:2" }];
    expect(cycleDurationMs({ parts, startIndex: 0, endIndex: 0, piMessages, turnStartMs: 0 })).toBeNull();
  });

  it("should return null when the end is before the start (inconsistent clock)", () => {
    const piMessages = [
      { role: "user", timestamp: 30_000 },
      { role: "assistant", timestamp: 5_000 },
      { role: "assistant", timestamp: 20_000 },
    ];
    const parts = [{ parentId: "pi-step:1" }, { parentId: "pi-step:2" }];
    expect(cycleDurationMs({ parts, startIndex: 0, endIndex: 0, piMessages, turnStartMs: 30_000 })).toBeNull();
  });

  it("should fall back to the first cycle's own turn timestamp when no user message precedes it", () => {
    // turn0 [thinking, toolCall](5s) → toolResult(6s) → turn2 [text](7s)
    const piMessages = [
      { role: "assistant", timestamp: 5_000 },
      { role: "toolResult", timestamp: 6_000 },
      { role: "assistant", timestamp: 7_000 },
    ];
    const parts = [{ parentId: "pi-step:0" }, { parentId: "pi-step:0" }, { parentId: "pi-step:2" }];
    expect(cycleDurationMs({ parts, startIndex: 0, endIndex: 1, piMessages, turnStartMs: null })).toBe(2_000);
  });

  it("should return 0 when the start and end anchors are equal", () => {
    const piMessages = [
      { role: "user", timestamp: 5_000 },
      { role: "assistant", timestamp: 5_000 },
    ];
    const parts = [{ parentId: "pi-step:1" }, { parentId: "pi-step:1" }];
    expect(cycleDurationMs({ parts, startIndex: 0, endIndex: 0, piMessages, turnStartMs: 5_000 })).toBe(0);
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
