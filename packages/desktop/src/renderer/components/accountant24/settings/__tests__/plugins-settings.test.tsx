// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginsList } from "@/rpc/types";

// IPC boundary: the page talks to main via pluginsApi/agentApi only.
const h = vi.hoisted(() => ({
  list: vi.fn<() => Promise<PluginsList>>(),
  inspect: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  onEvent: vi.fn(async (_cb: (event: { type: string; message?: string }) => void) => () => {}),
  marketplace: vi.fn(),
  restart: vi.fn(async () => {}),
}));

vi.mock("@/rpc/api", () => ({
  pluginsApi: {
    list: h.list,
    inspect: h.inspect,
    add: h.add,
    remove: h.remove,
    onEvent: h.onEvent,
    marketplace: h.marketplace,
  },
  agentApi: { restart: h.restart },
  // The marketplace section inside the page reports what it listed.
  analyticsApi: { track: vi.fn(), trackOnce: vi.fn() },
}));

import { PluginsSettings } from "../plugins-settings";

beforeAll(() => {
  // jsdom lacks the layout/observer APIs the dialog machinery touches.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
});

const emptyList: PluginsList = { plugins: [] };

// Skills are namespaced `<plugin>:<skill>` everywhere the UI shows them.
const populated: PluginsList = {
  plugins: [
    {
      name: "accountant24",
      description: "The accounting skills the app ships with.",
      source: "accountant24/skills",
      skills: [
        { name: "accountant24:subscription-audit", description: "Find recurring charges." },
        { name: "accountant24:recurring-spending", description: "Summarize repeat spending." },
      ],
    },
    {
      name: "pdf-tools",
      description: "Work with PDFs.",
      source: "acme/pdf-tools",
      skills: [{ name: "pdf-tools:pdf", description: "Read, split, and OCR PDFs." }],
    },
    {
      name: "my-manual",
      description: "Hand-made.",
      skills: [{ name: "my-manual:notes", description: "Take notes." }],
    },
    {
      name: "bad",
      description: "",
      skills: [],
      error: "Invalid plugin: plugin.json is missing a name.",
    },
  ],
};

beforeEach(() => {
  h.list.mockResolvedValue(emptyList);
  h.inspect.mockResolvedValue({
    type: "plugin",
    plugin: {
      name: "pdf-tools",
      description: "Work with PDFs.",
      repo: "acme/pdf-tools",
      repoUrl: "https://github.com/acme/pdf-tools",
      skills: [{ name: "pdf-tools:pdf", description: "Read, split, and OCR PDFs." }],
    },
  });
  h.add.mockResolvedValue({ type: "done", name: "pdf-tools" });
  h.remove.mockResolvedValue({ type: "done" });
  h.onEvent.mockResolvedValue(() => {});
  h.marketplace.mockResolvedValue({ type: "ok", plugins: [], fetchedAt: "2026-08-16T09:00:00.000Z" });
});

/** One published plugin, as the marketplace section lists it. */
const listed = {
  type: "ok" as const,
  fetchedAt: "2026-08-16T09:00:00.000Z",
  plugins: [
    {
      repo: "acme/pdf-tools",
      name: "pdf-tools",
      description: "Work with PDFs.",
      official: false,
      skills: [{ name: "pdf-tools:pdf", description: "Read, split, and OCR PDFs." }],
    },
  ],
};

/** The Uninstall button of one plugin's row, since every row has one. */
const uninstallButtonFor = async (name: string): Promise<HTMLElement> => {
  const row = (await screen.findByText(name)).closest("[data-slot=item]");
  return within(row as HTMLElement).getByRole("button", { name: "Uninstall" });
};

describe("PluginsSettings", () => {
  it("should show a loading state until the plugin list arrives", () => {
    h.list.mockReturnValue(new Promise(() => {}));
    render(<PluginsSettings />);
    expect(screen.getByText("Loading plugins…")).toBeTruthy();
  });

  it("should show only the marketplace on a workspace with no plugins at all", async () => {
    render(<PluginsSettings />);
    expect(await screen.findByText("Marketplace")).toBeTruthy();
    expect(screen.queryByText("Installed")).toBeNull();
  });

  it("should list built-in and added plugins together, by name", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    await screen.findByText("accountant24");
    const rows = screen.getAllByText(/^(accountant24|bad|my-manual|pdf-tools)$/).map((el) => el.textContent);
    expect(rows).toEqual(["accountant24", "bad", "my-manual", "pdf-tools"]);
  });

  it("should mark a plugin Accountant24 published as official", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    expect(await screen.findByText("Official")).toBeTruthy();
    // Exactly one: the other three came from elsewhere or from nowhere.
    expect(screen.getAllByText("Official")).toHaveLength(1);
  });

  it("should offer to uninstall every plugin, the app's own included", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    expect(await screen.findAllByRole("button", { name: "Uninstall" })).toHaveLength(4);
  });

  it("should keep rows to the plugin itself, leaving its skills to the composer's picker", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    await screen.findByText("accountant24");
    expect(screen.queryByText("accountant24:subscription-audit")).toBeNull();
    expect(screen.queryByText("pdf-tools:pdf")).toBeNull();
  });

  it("should link a plugin to the repository it came from", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    expect(await screen.findByRole("link", { name: "acme/pdf-tools" })).toHaveAttribute(
      "href",
      "https://github.com/acme/pdf-tools",
    );
  });

  it("should link a plugin to the repository its manifest declares when it was dropped in by hand", async () => {
    h.list.mockResolvedValue({
      plugins: [
        {
          name: "accountant24-skills",
          description: "Dropped in.",
          repository: "https://github.com/accountant24/skills",
          skills: [],
        },
      ],
    });
    render(<PluginsSettings />);

    expect(await screen.findByRole("link", { name: "accountant24/skills" })).toBeTruthy();
  });

  it("should describe a plugin by its first skill when the manifest carries no description", async () => {
    h.list.mockResolvedValue({
      plugins: [
        {
          name: "accountant24",
          description: "",
          skills: [{ name: "accountant24:subscription-audit", description: "Find recurring charges." }],
        },
      ],
    });
    render(<PluginsSettings />);
    expect(await screen.findByText("Find recurring charges.")).toBeTruthy();
  });

  it("should describe a plugin with neither a description nor skills as empty", async () => {
    h.list.mockResolvedValue({
      plugins: [{ name: "hollow", description: "", skills: [] }],
    });
    render(<PluginsSettings />);
    expect(await screen.findByText("hollow")).toBeTruthy();
    // No skill entries are drawn for a plugin that provides none.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("should not offer Show more when the description fits the two-line clamp", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);
    await screen.findByText("accountant24");
    // jsdom has no layout, so nothing overflows: no toggles anywhere.
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("should expand and collapse a truncated description via Show more / Show less", async () => {
    // jsdom does no layout, so model it: a "line" is 32px tall and fits 60
    // characters — longer content wraps taller. The measurer then finds a cut.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return 32 * Math.max(1, Math.ceil((this.textContent?.length ?? 0) / 60));
      },
    });
    try {
      h.list.mockResolvedValue({
        plugins: [
          {
            name: "wordy",
            description: `${"activation trigger words ".repeat(12)}the tail end nobody reads`,
            skills: [{ name: "wordy:essay", description: "Write essays." }],
          },
        ],
      });
      render(<PluginsSettings />);
      await screen.findByText("wordy");

      const toggle = await screen.findByRole("button", { name: "Show more" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      // The visible text is the truncated head, ellipsis attached, tail gone.
      expect(screen.getByText(/…/)).toBeTruthy();
      expect(screen.queryByText(/the tail end nobody reads/)).toBeNull();

      fireEvent.click(toggle);
      expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText(/the tail end nobody reads/)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Show less" }));
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
      expect(await screen.findByRole("button", { name: "Show more" })).toBeTruthy();
    } finally {
      // Drop the override so jsdom's own getter applies again.
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    }
  });

  it("should cut a description with no spaces mid-word rather than dropping the toggle", async () => {
    // Same modelled layout as above: one unbroken word has no space to break
    // on, so the cut lands mid-word instead of at a word boundary.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return 32 * Math.max(1, Math.ceil((this.textContent?.length ?? 0) / 60));
      },
    });
    try {
      h.list.mockResolvedValue({
        plugins: [
          {
            name: "unbroken",
            description: `${"x".repeat(200)}TAIL`,
            skills: [{ name: "unbroken:x", description: "X." }],
          },
        ],
      });
      render(<PluginsSettings />);
      await screen.findByText("unbroken");

      const toggle = await screen.findByRole("button", { name: "Show more" });
      expect(screen.queryByText(/TAIL/)).toBeNull();

      fireEvent.click(toggle);
      expect(screen.getByText(/TAIL/)).toBeTruthy();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    }
  });

  it("should say where each installed plugin came from", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    expect(await screen.findByText("my-manual")).toBeTruthy();
    expect(screen.getAllByText("acme/pdf-tools").length).toBeGreaterThan(0);
    // Both source-less rows (manual drop + broken folder) carry the Manual badge.
    expect(screen.getAllByText("Manual")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "accountant24/skills" })).toBeTruthy();
  });

  it("should offer no switch, since an installed plugin is active", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    await screen.findByText("my-manual");
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("should surface a broken plugin with its error and an Invalid badge", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    expect(await screen.findByText("Invalid")).toBeTruthy();
    expect(screen.getByText(/missing a name/)).toBeTruthy();
  });

  it("should explain why a skill is inactive when another plugin already claims its name", async () => {
    h.list.mockResolvedValue({
      plugins: [
        {
          name: "pdf-tools",
          description: "Work with PDFs.",
          source: "acme/pdf-tools",
          skills: [
            {
              name: "pdf-tools:pdf",
              description: "Read PDFs.",
              error: "Skill name already used by the accountant24 plugin.",
            },
          ],
        },
      ],
    });
    render(<PluginsSettings />);
    expect(await screen.findByText(/Skill name already used by the accountant24 plugin\./)).toBeTruthy();
    expect(screen.getByText("pdf-tools:pdf")).toBeTruthy();
  });

  it("should uninstall a plugin after confirmation, then restart and reload", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    fireEvent.click(await uninstallButtonFor("pdf-tools"));

    // Nothing happens until the confirmation dialog's own Remove is clicked.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Uninstall plugin?")).toBeTruthy();
    expect(h.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Uninstall" }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith("pdf-tools"));
    await waitFor(() => expect(h.restart).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("should not uninstall a plugin when the confirmation is cancelled", async () => {
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    fireEvent.click(await uninstallButtonFor("pdf-tools"));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.restart).not.toHaveBeenCalled();
  });

  it("should show an error banner and skip the restart when the uninstall fails", async () => {
    h.list.mockResolvedValue(populated);
    h.remove.mockResolvedValue({ type: "error", message: "built-in plugins can't be removed" });
    render(<PluginsSettings />);

    fireEvent.click(await uninstallButtonFor("pdf-tools"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Uninstall" }));

    expect(await screen.findByText(/built-in plugins can't be removed/)).toBeTruthy();
    expect(h.restart).not.toHaveBeenCalled();
  });

  it("should fall back to a generic message when the removal error carries none", async () => {
    h.list.mockResolvedValue(populated);
    h.remove.mockResolvedValue({ type: "error" });
    render(<PluginsSettings />);

    fireEvent.click(await uninstallButtonFor("pdf-tools"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Uninstall" }));

    expect(await screen.findByText(/Failed to remove plugin/)).toBeTruthy();
  });

  it("should install the marketplace plugin the user picked, then restart", async () => {
    h.marketplace.mockResolvedValue(listed);
    render(<PluginsSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    // The dialog confirms the row's own data; nothing is fetched until Install.
    expect(await screen.findByText("Install plugin?")).toBeTruthy();
    expect(h.inspect).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Install" }));

    await waitFor(() => expect(h.inspect).toHaveBeenCalledWith({ source: "acme/pdf-tools" }));
    await waitFor(() => expect(h.add).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.restart).toHaveBeenCalled());
  });

  it("should leave an installed plugin out of the marketplace list", async () => {
    h.marketplace.mockResolvedValue(listed);
    h.list.mockResolvedValue(populated);
    render(<PluginsSettings />);

    expect(await screen.findByText("Every published plugin is already installed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("should drop a list that resolves after the page is gone", async () => {
    let resolveList: (list: PluginsList) => void = () => {};
    h.list.mockReturnValue(new Promise<PluginsList>((r) => (resolveList = r)));
    const { unmount } = render(<PluginsSettings />);
    unmount();

    // The late answer must not reach the unmounted page's state.
    expect(() => resolveList(populated)).not.toThrow();
    await waitFor(() => expect(screen.queryByText("accountant24")).toBeNull());
  });
});

describe("PluginsSettings, when main installs a plugin on its own", () => {
  /** The subscriber the page hands to pluginsApi.onEvent. */
  const emit = (event: { type: string; message?: string }) => {
    for (const call of h.onEvent.mock.calls) (call[0] as (e: unknown) => void)(event);
  };

  it("should show a plugin that landed while the page was open", async () => {
    h.list.mockResolvedValue({ plugins: [] });
    render(<PluginsSettings />);
    await waitFor(() => expect(h.onEvent).toHaveBeenCalled());
    expect(screen.queryByText("accountant24-skills")).not.toBeInTheDocument();

    h.list.mockResolvedValue({
      plugins: [
        {
          name: "accountant24-skills",
          description: "The skills the app comes with.",
          source: "accountant24/skills",
          skills: [{ name: "accountant24-skills:monthly-review", description: "Reviews the month." }],
        },
      ],
    });
    emit({ type: "changed" });

    expect(await screen.findByText("accountant24-skills")).toBeInTheDocument();
  });

  it("should not reload on the progress lines of an install in the dialog", async () => {
    h.list.mockResolvedValue({ plugins: [] });
    render(<PluginsSettings />);
    await waitFor(() => expect(h.onEvent).toHaveBeenCalled());
    h.list.mockClear();

    emit({ type: "progress", message: "Downloading acme/pdf-tools…" });

    expect(h.list).not.toHaveBeenCalled();
  });
});
