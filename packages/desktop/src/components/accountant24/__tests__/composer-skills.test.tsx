// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillsList } from "@/rpc/types";

// IPC boundary: skills come from skillsApi, refresh signal from agentApi.
const h = vi.hoisted(() => ({
  list: vi.fn<() => Promise<SkillsList>>(),
  modelsChangedListeners: [] as (() => void)[],
}));

vi.mock("@/rpc/api", () => ({
  skillsApi: { list: h.list },
  agentApi: {
    onModelsChanged: (cb: () => void) => {
      h.modelsChangedListeners.push(cb);
      return () => {
        h.modelsChangedListeners = h.modelsChangedListeners.filter((l) => l !== cb);
      };
    },
  },
}));

import type { Unstable_TriggerItem } from "@assistant-ui/react";
import { createSkillsAdapter, useEnabledSkills } from "../composer-skills";
import { groupSkillRows } from "../composer-skills-popover";

/** Minimal trigger item for grouping specs. */
function triggerItem(id: string, native: boolean): Unstable_TriggerItem {
  return { id, type: "skill", label: id, metadata: { native } };
}

/** Probe rendering the hook's result as text. */
function Probe() {
  const skills = useEnabledSkills();
  return <div data-testid="skills">{skills.map((s) => s.name).join(",")}</div>;
}

const LIST: SkillsList = {
  skills: [
    { name: "pdf", description: "PDFs.", enabled: true },
    { name: "xlsx", description: "Sheets.", enabled: false },
    { name: "broken", description: "", enabled: true, error: "Invalid skill" },
    { name: "web-search", description: "Web.", enabled: true },
  ],
};

beforeEach(() => {
  h.list.mockResolvedValue(LIST);
  h.modelsChangedListeners = [];
});

afterEach(() => {
  cleanup();
});

describe("useEnabledSkills()", () => {
  it("should expose only enabled, valid skills", async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("skills").textContent).toBe("pdf,web-search"));
  });

  it("should refresh when the agent restarts (models-changed event)", async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("skills").textContent).toBe("pdf,web-search"));

    h.list.mockResolvedValue({
      skills: [{ name: "docx", description: "Docs.", enabled: true }],
    });
    act(() => {
      for (const cb of h.modelsChangedListeners) cb();
    });

    await waitFor(() => expect(screen.getByTestId("skills").textContent).toBe("docx"));
  });

  it("should unsubscribe from the restart signal on unmount", async () => {
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(h.modelsChangedListeners).toHaveLength(1));
    unmount();
    expect(h.modelsChangedListeners).toHaveLength(0);
  });

  it("should return an empty list when the fetch fails", async () => {
    h.list.mockRejectedValue(new Error("ipc down"));
    render(<Probe />);
    // Never throws; stays empty.
    await waitFor(() => expect(screen.getByTestId("skills").textContent).toBe(""));
  });
});

describe("createSkillsAdapter()", () => {
  const skills = [
    { name: "pdf", description: "Read, split, and OCR PDF files.", enabled: true },
    { name: "web-search", description: "Search the web via Brave.", enabled: true },
  ];

  it("should list built-in skills before custom ones regardless of input order", () => {
    const adapter = createSkillsAdapter([
      { name: "custom-a", description: "A.", enabled: true },
      { name: "native-b", description: "B.", enabled: true, native: true },
      { name: "custom-c", description: "C.", enabled: true },
      { name: "native-d", description: "D.", enabled: true, native: true },
    ]);
    expect(adapter.search?.("")?.map((i) => i.id)).toEqual(["native-b", "native-d", "custom-a", "custom-c"]);
  });

  it("should carry the group on item metadata", () => {
    const adapter = createSkillsAdapter([
      { name: "native-b", description: "B.", enabled: true, native: true },
      { name: "custom-a", description: "A.", enabled: true },
    ]);
    const items = adapter.search?.("") ?? [];
    expect(items.map((i) => i.metadata)).toEqual([{ native: true }, { native: false }]);
  });

  it("should expose no categories (skills are one flat list)", () => {
    const adapter = createSkillsAdapter(skills);
    expect(adapter.categories()).toEqual([]);
    expect(adapter.categoryItems("anything")).toEqual([]);
  });

  it("should list every skill for an empty query", () => {
    const items = createSkillsAdapter(skills).search?.("") ?? [];
    expect(items.map((i) => i.id)).toEqual(["pdf", "web-search"]);
    expect(items[0]).toMatchObject({ type: "skill", label: "pdf", description: "Read, split, and OCR PDF files." });
  });

  it("should match by name, case-insensitively", () => {
    const items = createSkillsAdapter(skills).search?.("PDF") ?? [];
    expect(items.map((i) => i.id)).toEqual(["pdf"]);
  });

  it("should match by description", () => {
    const items = createSkillsAdapter(skills).search?.("brave") ?? [];
    expect(items.map((i) => i.id)).toEqual(["web-search"]);
  });

  it("should return nothing when no skill matches", () => {
    expect(createSkillsAdapter(skills).search?.("xlsx")).toEqual([]);
  });

  it("should carry the full description on the item (the popover clamps it visually)", () => {
    const long = "x".repeat(300);
    const adapter = createSkillsAdapter([{ name: "a", description: long, enabled: true }]);
    const [item] = adapter.search?.("") ?? [];
    expect(item?.description).toBe(long);
  });

  it("should match description text beyond the visible clamp", () => {
    const description = `${"filler ".repeat(40)}needle at the very end`;
    const adapter = createSkillsAdapter([{ name: "a", description, enabled: true }]);
    expect(adapter.search?.("needle")?.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("groupSkillRows()", () => {
  it("should put a header on the first row of each group when both groups are present", () => {
    const rows = groupSkillRows([
      triggerItem("native-a", true),
      triggerItem("native-b", true),
      triggerItem("custom-c", false),
      triggerItem("custom-d", false),
    ]);
    expect(rows.map((r) => r.header)).toEqual(["Built-in", undefined, "Custom", undefined]);
  });

  it("should keep flat indices in item order (the keyboard-nav contract)", () => {
    const rows = groupSkillRows([triggerItem("a", true), triggerItem("b", false), triggerItem("c", false)]);
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.item.id)).toEqual(["a", "b", "c"]);
  });

  it("should render no headers when only built-in skills match", () => {
    const rows = groupSkillRows([triggerItem("a", true), triggerItem("b", true)]);
    expect(rows.every((r) => r.header === undefined)).toBe(true);
  });

  it("should render no headers when only custom skills match", () => {
    const rows = groupSkillRows([triggerItem("a", false), triggerItem("b", false)]);
    expect(rows.every((r) => r.header === undefined)).toBe(true);
  });

  it("should treat items without metadata as custom", () => {
    const rows = groupSkillRows([
      triggerItem("native-a", true),
      { id: "bare", type: "skill", label: "bare" } as Unstable_TriggerItem,
    ]);
    expect(rows.map((r) => r.header)).toEqual(["Built-in", "Custom"]);
  });

  it("should return an empty list for no items", () => {
    expect(groupSkillRows([])).toEqual([]);
  });
});
