// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginInfo, PluginsList } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: skills come from the plugins pluginsApi lists, refresh signal
// from agentApi.
const h = vi.hoisted(() => ({
  list: vi.fn<() => Promise<PluginsList>>(),
  modelsChangedListeners: [] as (() => void)[],
  /** plugins-event subscribers: main installs the default plugins on its own. */
  pluginsEventListeners: [] as ((event: { type: string; message?: string }) => void)[],
  onEvent: vi.fn(async (cb: (event: { type: string; message?: string }) => void) => {
    h.pluginsEventListeners.push(cb);
    return () => {
      h.pluginsEventListeners = h.pluginsEventListeners.filter((fn) => fn !== cb);
    };
  }),
}));

vi.mock("@/rpc/api", () => ({
  pluginsApi: { list: h.list, onEvent: h.onEvent },
  agentApi: {
    onModelsChanged: (cb: () => void) => {
      h.modelsChangedListeners.push(cb);
      return () => {
        h.modelsChangedListeners = h.modelsChangedListeners.filter((l) => l !== cb);
      };
    },
  },
}));

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  type ExternalStoreAdapter,
  type Unstable_TriggerItem,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { ReactNode } from "react";
import {
  ComposerSkills,
  createSkillsAdapter,
  type PickerSkill,
  pickerSkills,
  useEnabledSkills,
} from "../composer-skills";
import { ComposerSkillsPopover, groupSkillRows } from "../composer-skills-popover";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

/** Minimal trigger item for grouping specs. */
function triggerItem(id: string, official: boolean): Unstable_TriggerItem {
  return { id, type: "skill", label: id, metadata: { official } };
}

/** Probe rendering the hook's result as text. */
function Probe() {
  const skills = useEnabledSkills();
  return <div data-testid="skills">{skills.map((s) => s.name).join(",")}</div>;
}

/** Shorthand for a plugin row as pluginsApi.list() reports it. */
function plugin(name: string, skills: PluginInfo["skills"], extra: Partial<PluginInfo> = {}): PluginInfo {
  return { name, description: `${name} plugin.`, skills, ...extra };
}

const LIST: PluginsList = {
  plugins: [
    plugin("docs", [
      { name: "docs:pdf", description: "PDFs." },
      { name: "docs:broken", description: "", error: "Skill name already used by the files plugin." },
    ]),
    plugin("web", [{ name: "web:web-search", description: "Web." }]),
    plugin("rotten", [], { error: "Plugin has no skills." }),
  ],
};

beforeEach(() => {
  h.list.mockResolvedValue(LIST);
  h.modelsChangedListeners = [];
});

afterEach(() => {
  cleanup();
});

describe("pickerSkills()", () => {
  it("should return no skills when there are no plugins", () => {
    expect(pickerSkills([])).toEqual([]);
  });

  it("should flatten every skill of an enabled plugin, in plugin order", () => {
    const skills = pickerSkills([
      plugin("docs", [
        { name: "docs:pdf", description: "PDFs." },
        { name: "docs:docx", description: "Docs." },
      ]),
      plugin("web", [{ name: "web:web-search", description: "Web." }]),
    ]);
    expect(skills).toEqual([
      { name: "docs:pdf", description: "PDFs.", official: false },
      { name: "docs:docx", description: "Docs.", official: false },
      { name: "web:web-search", description: "Web.", official: false },
    ]);
  });

  it("should drop the skills of a plugin that failed to load", () => {
    const skills = pickerSkills([
      plugin("rotten", [{ name: "rotten:x", description: "X." }], { error: "Plugin has no skills." }),
    ]);
    expect(skills).toEqual([]);
  });

  it("should drop a single skill that failed to load and keep its siblings", () => {
    const skills = pickerSkills([
      plugin("docs", [
        { name: "docs:pdf", description: "PDFs." },
        { name: "docs:broken", description: "", error: "Skill name already used by the files plugin." },
      ]),
    ]);
    expect(skills.map((s) => s.name)).toEqual(["docs:pdf"]);
  });

  it("should mark an official plugin's skills as official", () => {
    const skills = pickerSkills([
      plugin("accountant24", [{ name: "accountant24:subscription-audit", description: "Subs." }], {
        source: "accountant24/skills",
      }),
    ]);
    expect(skills).toEqual([{ name: "accountant24:subscription-audit", description: "Subs.", official: true }]);
  });

  it("should mark a community plugin's skills as not official", () => {
    const skills = pickerSkills([plugin("web", [{ name: "web:web-search", description: "Web." }])]);
    expect(skills[0]?.official).toBe(false);
  });
});

describe("useEnabledSkills()", () => {
  it("should expose only the skills of enabled, valid plugins", async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("skills").textContent).toBe("docs:pdf,web:web-search"));
  });

  it("should refresh when the agent restarts (models-changed event)", async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("skills").textContent).toBe("docs:pdf,web:web-search"));

    h.list.mockResolvedValue({
      plugins: [plugin("docs", [{ name: "docs:docx", description: "Docs." }])],
    });
    act(() => {
      for (const cb of h.modelsChangedListeners) cb();
    });

    await waitFor(() => expect(screen.getByTestId("skills").textContent).toBe("docs:docx"));
  });

  it("should pick up a plugin main installed on its own", async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("skills").textContent).toBe("docs:pdf,web:web-search"));

    h.list.mockResolvedValue({
      plugins: [plugin("accountant24-skills", [{ name: "accountant24-skills:monthly-review", description: "Month." }])],
    });
    act(() => {
      for (const cb of h.pluginsEventListeners) cb({ type: "changed" });
    });

    await waitFor(() => expect(screen.getByTestId("skills").textContent).toBe("accountant24-skills:monthly-review"));
  });

  it("should ignore the progress lines of an install in Settings", async () => {
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("skills").textContent).toBe("docs:pdf,web:web-search"));
    h.list.mockClear();

    act(() => {
      for (const cb of h.pluginsEventListeners) cb({ type: "progress", message: "Downloading…" });
    });

    expect(h.list).not.toHaveBeenCalled();
  });

  it("should unsubscribe from the store-changed signal on unmount", async () => {
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(h.pluginsEventListeners).toHaveLength(1));
    unmount();
    await waitFor(() => expect(h.pluginsEventListeners).toHaveLength(0));
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
  const skills: PickerSkill[] = [
    { name: "pdf", description: "Read, split, and OCR PDF files.", official: false },
    { name: "web-search", description: "Search the web via Brave.", official: false },
  ];

  it("should list official skills before custom ones regardless of input order", () => {
    const adapter = createSkillsAdapter([
      { name: "custom-a", description: "A.", official: false },
      { name: "official-b", description: "B.", official: true },
      { name: "custom-c", description: "C.", official: false },
      { name: "official-d", description: "D.", official: true },
    ]);
    expect(adapter.search?.("")?.map((i) => i.id)).toEqual(["official-b", "official-d", "custom-a", "custom-c"]);
  });

  it("should carry the group on item metadata", () => {
    const adapter = createSkillsAdapter([
      { name: "official-b", description: "B.", official: true },
      { name: "custom-a", description: "A.", official: false },
    ]);
    const items = adapter.search?.("") ?? [];
    expect(items.map((i) => i.metadata)).toEqual([{ official: true }, { official: false }]);
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

  it("should match a namespaced name by its skill half", () => {
    const namespaced = createSkillsAdapter([
      { name: "docs:pdf", description: "Read PDFs.", official: false },
      { name: "web:search", description: "Search.", official: false },
    ]);
    expect(namespaced.search?.("pdf")?.map((i) => i.id)).toEqual(["docs:pdf"]);
  });

  it("should match a namespaced name by its plugin half", () => {
    const namespaced = createSkillsAdapter([
      { name: "docs:pdf", description: "Read PDFs.", official: false },
      { name: "docs:ocr", description: "Scan pages.", official: false },
      { name: "web:search", description: "Search.", official: false },
    ]);
    expect(namespaced.search?.("docs")?.map((i) => i.id)).toEqual(["docs:pdf", "docs:ocr"]);
  });

  it("should match by description when nothing matches by name", () => {
    const items = createSkillsAdapter(skills).search?.("brave") ?? [];
    expect(items.map((i) => i.id)).toEqual(["web-search"]);
  });

  it("should return only the name matches when a query matches both a name and other descriptions", () => {
    // The regression this guards: descriptions are long prose written to steer
    // the model, so a query that names one skill routinely appears somewhere
    // inside unrelated descriptions. Typing a name must not surface those.
    const items =
      createSkillsAdapter([
        { name: "create-plugin", description: "Turns a routine into a plugin.", official: true },
        { name: "recurring-spending", description: "Flags price increases every month.", official: true },
        { name: "subscription-audit", description: "Flags price increases and duplicates.", official: true },
      ]).search?.("crea") ?? [];
    expect(items.map((i) => i.id)).toEqual(["create-plugin"]);
  });

  it("should keep the official skills' own descriptions from swamping a name search", () => {
    // Built verbatim from the shipped SKILL.md descriptions: all three contain
    // "crea" (once as "create", twice inside "increases"), which is exactly the
    // collision that made the picker look unfiltered.
    const builtIns: PickerSkill[] = [
      {
        name: "accountant24:create-plugin",
        description: "Use when the user asks to create a skill or a plugin.",
        official: true,
      },
      {
        name: "accountant24:recurring-spending",
        description: "Flags price increases and expected payments that stopped arriving.",
        official: true,
      },
      {
        name: "accountant24:subscription-audit",
        description: "Flags price increases, duplicate services, forgotten charges.",
        official: true,
      },
    ];
    expect(
      createSkillsAdapter(builtIns)
        .search?.("crea")
        ?.map((i) => i.id),
    ).toEqual(["accountant24:create-plugin"]);
  });

  it("should return nothing when no skill matches by name or description", () => {
    expect(createSkillsAdapter(skills).search?.("xlsx")).toEqual([]);
  });

  it("should carry the full description on the item (the popover clamps it visually)", () => {
    const long = "x".repeat(300);
    const adapter = createSkillsAdapter([{ name: "a", description: long, official: false }]);
    const [item] = adapter.search?.("") ?? [];
    expect(item?.description).toBe(long);
  });

  it("should match description text beyond the visible clamp", () => {
    const description = `${"filler ".repeat(40)}needle at the very end`;
    const adapter = createSkillsAdapter([{ name: "a", description, official: false }]);
    expect(adapter.search?.("needle")?.map((i) => i.id)).toEqual(["a"]);
  });

  it("should keep officials ahead of community skills within the name matches", () => {
    const adapter = createSkillsAdapter([
      { name: "custom:review", description: "C.", official: false },
      { name: "builtin:review", description: "B.", official: true },
    ]);
    expect(adapter.search?.("review")?.map((i) => i.id)).toEqual(["builtin:review", "custom:review"]);
  });

  it("should keep officials ahead of community skills within the description fallback", () => {
    const adapter = createSkillsAdapter([
      { name: "custom:a", description: "Mentions widgets.", official: false },
      { name: "builtin:b", description: "Also mentions widgets.", official: true },
    ]);
    expect(adapter.search?.("widgets")?.map((i) => i.id)).toEqual(["builtin:b", "custom:a"]);
  });
});

describe("groupSkillRows()", () => {
  it("should put a header on the first row of each group when both groups are present", () => {
    const rows = groupSkillRows([
      triggerItem("official-a", true),
      triggerItem("official-b", true),
      triggerItem("custom-c", false),
      triggerItem("custom-d", false),
    ]);
    expect(rows.map((r) => r.header)).toEqual(["Official", undefined, "Community", undefined]);
  });

  it("should keep flat indices in item order (the keyboard-nav contract)", () => {
    const rows = groupSkillRows([triggerItem("a", true), triggerItem("b", false), triggerItem("c", false)]);
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.item.id)).toEqual(["a", "b", "c"]);
  });

  it("should render no headers when only official skills match", () => {
    const rows = groupSkillRows([triggerItem("a", true), triggerItem("b", true)]);
    expect(rows.every((r) => r.header === undefined)).toBe(true);
  });

  it("should render no headers when only community skills match", () => {
    const rows = groupSkillRows([triggerItem("a", false), triggerItem("b", false)]);
    expect(rows.every((r) => r.header === undefined)).toBe(true);
  });

  it("should treat items without metadata as custom", () => {
    const rows = groupSkillRows([
      triggerItem("official-a", true),
      { id: "bare", type: "skill", label: "bare" } as Unstable_TriggerItem,
    ]);
    expect(rows.map((r) => r.header)).toEqual(["Official", "Community"]);
  });

  it("should return an empty list for no items", () => {
    expect(groupSkillRows([])).toEqual([]);
  });
});

describe("<ComposerSkillsPopover />", () => {
  const SKILLS: PickerSkill[] = [
    { name: "docs:pdf", description: "Read and split PDFs.", official: true },
    { name: "money:budget", description: "Plan a monthly budget.", official: false },
  ];

  /** A live composer hosting the `/` skills popover, fed the given skills. */
  function Picker({ skills, emptyLabel }: { skills: typeof SKILLS; emptyLabel: string }) {
    const adapter = createSkillsAdapter(skills);
    return (
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Root>
          <ComposerPrimitive.Input />
          <ComposerSkillsPopover adapter={adapter} emptyLabel={emptyLabel} />
        </ComposerPrimitive.Root>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
    );
  }

  function renderPicker(skills = SKILLS, emptyLabel = "No skills found") {
    function Chrome({ children }: { children: ReactNode }) {
      const store: ExternalStoreAdapter = { messages: [], onNew: async () => {} };
      const runtime = useExternalStoreRuntime(store);
      return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
    }
    render(
      <Chrome>
        <Picker skills={skills} emptyLabel={emptyLabel} />
      </Chrome>,
    );
    return screen.getByRole("textbox") as HTMLTextAreaElement;
  }

  /** Type `value` and place the cursor at its end — the trigger detector reads both. */
  const type = (input: HTMLTextAreaElement, value: string) => {
    fireEvent.change(input, { target: { value } });
    input.selectionStart = value.length;
    input.selectionEnd = value.length;
    fireEvent.select(input);
  };

  /** A row by its full `plugin:skill` name. The row draws the plugin part
   *  muted, in its own element, so the name is matched on the row's title
   *  (its tooltip) rather than as one run of text. */
  const skillRow = (name: string) => screen.queryByTitle(name);
  const getSkillRow = (name: string) => screen.getByTitle(name);

  it("should stay closed until a leading slash is typed", () => {
    renderPicker();
    expect(skillRow("docs:pdf")).toBeNull();
  });

  it("should open on a leading slash and list every enabled skill with its description", async () => {
    const input = renderPicker();
    type(input, "/");
    await waitFor(() => expect(getSkillRow("docs:pdf")).toBeInTheDocument());
    expect(getSkillRow("money:budget")).toBeInTheDocument();
    expect(screen.getByText("Read and split PDFs.")).toBeInTheDocument();
  });

  it("should show inline Official and Custom section headers when both groups are present", async () => {
    const input = renderPicker();
    type(input, "/");
    await waitFor(() => expect(getSkillRow("docs:pdf")).toBeInTheDocument());
    expect(screen.getByText("Official")).toBeInTheDocument();
    expect(screen.getByText("Community")).toBeInTheDocument();
  });

  it("should narrow the list to the matching skill as the query is typed", async () => {
    const input = renderPicker();
    type(input, "/budget");
    await waitFor(() => expect(getSkillRow("money:budget")).toBeInTheDocument());
    expect(skillRow("docs:pdf")).toBeNull();
  });

  it("should show the empty label when no skill matches the query", async () => {
    const input = renderPicker(SKILLS, "No skills found");
    type(input, "/zzz");
    await waitFor(() => expect(screen.getByText("No skills found")).toBeInTheDocument());
  });

  it("should close the popover once a skill is selected", async () => {
    const input = renderPicker();
    type(input, "/");
    await waitFor(() => expect(getSkillRow("money:budget")).toBeInTheDocument());
    fireEvent.click(getSkillRow("money:budget"));
    // Selecting inserts the directive chip and deactivates the trigger.
    await waitFor(() => expect(screen.queryByText("Read and split PDFs.")).toBeNull());
  });

  it("should narrow to the named skill even when other descriptions contain the query", async () => {
    // End to end through the real trigger machinery, over the collision that
    // made the picker look unfiltered: "crea" names one skill and hides inside
    // "increases" in the other two.
    const input = renderPicker([
      { name: "a24:create-plugin", description: "Use when the user asks to create a skill.", official: true },
      { name: "a24:recurring-spending", description: "Flags price increases every month.", official: true },
      { name: "a24:subscription-audit", description: "Flags price increases and duplicates.", official: true },
    ]);
    type(input, "/crea");
    await waitFor(() => expect(getSkillRow("a24:create-plugin")).toBeInTheDocument());
    expect(skillRow("a24:recurring-spending")).toBeNull();
    expect(skillRow("a24:subscription-audit")).toBeNull();
  });
});

describe("<ComposerSkills />", () => {
  /** The live composer with the real picker, fed by the mocked plugins IPC. */
  function renderSkills() {
    function Chrome({ children }: { children: ReactNode }) {
      const store: ExternalStoreAdapter = { messages: [], onNew: async () => {} };
      const runtime = useExternalStoreRuntime(store);
      return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
    }
    render(
      <Chrome>
        <ComposerPrimitive.Unstable_TriggerPopoverRoot>
          <ComposerPrimitive.Root>
            <ComposerPrimitive.Input />
            <ComposerSkills />
          </ComposerPrimitive.Root>
        </ComposerPrimitive.Unstable_TriggerPopoverRoot>
      </Chrome>,
    );
    return screen.getByRole("textbox") as HTMLTextAreaElement;
  }

  const type = (input: HTMLTextAreaElement, value: string) => {
    fireEvent.change(input, { target: { value } });
    input.selectionStart = value.length;
    input.selectionEnd = value.length;
    fireEvent.select(input);
  };

  it("should point at Settings when there are no skills at all", async () => {
    h.list.mockResolvedValue({ plugins: [] });
    const input = renderSkills();
    type(input, "/");
    await waitFor(() => expect(screen.getByText("No skills available")).toBeInTheDocument());
  });

  it("should say nothing matched when skills exist but the query matches none", async () => {
    const input = renderSkills();
    type(input, "/zzzq");
    await waitFor(() => expect(screen.getByText("No matching skills")).toBeInTheDocument());
    // The "install a plugin" pointer is wrong here: the user has skills.
    expect(screen.queryByText(/Install a plugin/)).toBeNull();
  });
});
