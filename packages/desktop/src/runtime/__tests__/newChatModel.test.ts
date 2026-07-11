import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelRef } from "../../rpc/types";
import { newChatModel } from "../newChatModel";

const MODEL: ModelRef = { provider: "anthropic", modelId: "opus" };

afterEach(() => {
  // Reset the module singleton so tests don't leak state into each other.
  newChatModel.set(undefined);
});

describe("newChatModel", () => {
  it("should return undefined before anything is set", () => {
    expect(newChatModel.get()).toBeUndefined();
  });

  it("should store the model that was set", () => {
    newChatModel.set(MODEL);
    expect(newChatModel.get()).toEqual(MODEL);
  });

  it("should clear the pending pick when set to undefined", () => {
    newChatModel.set(MODEL);
    newChatModel.set(undefined);
    expect(newChatModel.get()).toBeUndefined();
  });

  it("should notify every subscriber on a change", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = newChatModel.subscribe(a);
    const offB = newChatModel.subscribe(b);
    newChatModel.set(MODEL);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it("should stop notifying after unsubscribe", () => {
    const cb = vi.fn();
    const off = newChatModel.subscribe(cb);
    off();
    newChatModel.set(MODEL);
    expect(cb).not.toHaveBeenCalled();
  });
});
