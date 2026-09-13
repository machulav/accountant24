import { describe, expect, it } from "vitest";
import { pageChats } from "../../content/site";
import { buildPageChats, featureTargetId, HERO_DEMO_ID } from "../page-chats";

describe("featureTargetId()", () => {
  it("should number features from 1", () => {
    expect(featureTargetId(0)).toBe("feature-1");
    expect(featureTargetId(6)).toBe("feature-7");
  });
});

describe("buildPageChats()", () => {
  it("should list the hero chat first, pointing at the hero demo", () => {
    expect(buildPageChats("Groceries", ["Import"])[0]).toEqual({ title: "Groceries", target: HERO_DEMO_ID });
  });

  it("should list one chat per feature after the hero chat, in order", () => {
    expect(buildPageChats("Groceries", ["Import", "Undo"])).toEqual([
      { title: "Groceries", target: "demo" },
      { title: "Import", target: "feature-1" },
      { title: "Undo", target: "feature-2" },
    ]);
  });

  it("should list only the hero chat when there are no features", () => {
    expect(buildPageChats("Groceries", [])).toEqual([{ title: "Groceries", target: "demo" }]);
  });

  it("should give every chat a distinct target", () => {
    const targets = buildPageChats("a", ["b", "c", "d"]).map((chat) => chat.target);
    expect(new Set(targets).size).toBe(4);
  });
});

describe("pageChats", () => {
  it("should give every chat on the page a distinct, non-empty title", () => {
    const titles = pageChats.map((chat) => chat.title.trim());
    expect(titles.every((title) => title.length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
