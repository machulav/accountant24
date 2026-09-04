// @vitest-environment jsdom

// Spec for the prompt idea decks' persistence: a lenient load (fresh decks on
// anything unreadable, unknown groups and non-ids dropped) and a save that
// never throws.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { loadPromptIdeaDecks, savePromptIdeaDecks } from "../prompt-idea-decks";

const KEY = "accountant24.prompt-idea-decks";

beforeAll(() => installJsdomPolyfills());
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("loadPromptIdeaDecks()", () => {
  it("should return fresh decks when nothing is stored", () => {
    expect(loadPromptIdeaDecks()).toEqual({});
  });

  it("should return the stored decks", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ "getting-started": ["what-can-you-do"], history: [] }));
    expect(loadPromptIdeaDecks()).toEqual({ "getting-started": ["what-can-you-do"], history: [] });
  });

  it("should return fresh decks when the stored value is not JSON", () => {
    window.localStorage.setItem(KEY, "{oops");
    expect(loadPromptIdeaDecks()).toEqual({});
  });

  it("should return fresh decks when the stored value is not an object", () => {
    window.localStorage.setItem(KEY, JSON.stringify(["ask"]));
    expect(loadPromptIdeaDecks()).toEqual({});
    window.localStorage.setItem(KEY, "null");
    expect(loadPromptIdeaDecks()).toEqual({});
  });

  it("should drop unknown groups, non-array decks, and non-string entries", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ bogus: ["x"], ask: "not-a-deck", skills: ["list-skills", 3, null] }),
    );
    expect(loadPromptIdeaDecks()).toEqual({ skills: ["list-skills"] });
  });

  it("should return fresh decks when localStorage is unavailable", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPromptIdeaDecks()).toEqual({});
  });
});

describe("savePromptIdeaDecks()", () => {
  it("should store the decks for the next load", () => {
    savePromptIdeaDecks({ rules: ["recurring-bills"], history: [] });
    expect(loadPromptIdeaDecks()).toEqual({ rules: ["recurring-bills"], history: [] });
  });

  it("should not throw when localStorage rejects the write", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => savePromptIdeaDecks({ history: [] })).not.toThrow();
  });
});
