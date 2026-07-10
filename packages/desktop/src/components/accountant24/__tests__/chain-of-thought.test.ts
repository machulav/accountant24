import { describe, expect, it } from "vitest";
import { chainLabel, turnDurationMs } from "../chain-of-thought";

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
