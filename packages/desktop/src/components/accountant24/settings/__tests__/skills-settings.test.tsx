// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillsList } from "@/rpc/types";

// IPC boundary: the page talks to main via skillsApi/agentApi only.
const h = vi.hoisted(() => ({
  list: vi.fn<() => Promise<SkillsList>>(),
  add: vi.fn(),
  remove: vi.fn(),
  setEnabled: vi.fn(),
  onEvent: vi.fn(async () => () => {}),
  restart: vi.fn(async () => {}),
}));

vi.mock("@/rpc/api", () => ({
  skillsApi: {
    list: h.list,
    add: h.add,
    remove: h.remove,
    setEnabled: h.setEnabled,
    onEvent: h.onEvent,
  },
  agentApi: { restart: h.restart },
}));

import { SkillsSettings } from "../skills-settings";

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

const emptyList: SkillsList = { skills: [] };

const populated: SkillsList = {
  skills: [
    { name: "subscription-audit", description: "Find recurring charges.", enabled: true, native: true },
    { name: "pdf", description: "Work with PDFs.", enabled: true, source: "anthropics/skills" },
    { name: "my-manual", description: "Hand-made.", enabled: false },
    { name: "bad", description: "", enabled: true, error: "Invalid skill: SKILL.md is missing a description." },
  ],
};

beforeEach(() => {
  h.list.mockResolvedValue(emptyList);
  h.add.mockResolvedValue({ type: "done", added: ["pdf"], skipped: [] });
  h.remove.mockResolvedValue({ type: "done" });
  h.setEnabled.mockResolvedValue({ type: "done" });
  h.onEvent.mockResolvedValue(() => {});
});

describe("SkillsSettings", () => {
  it("should hide the Built-in and Custom sections on a fresh workspace, keeping only the add section", async () => {
    render(<SkillsSettings />);
    expect(await screen.findByText("Add from GitHub repository")).toBeTruthy();
    expect(screen.queryByText("Built-in")).toBeNull();
    expect(screen.queryByText("Custom")).toBeNull();
  });

  it("should hide the Custom section when only native skills exist", async () => {
    h.list.mockResolvedValue({
      skills: [{ name: "subscription-audit", description: "Find recurring charges.", enabled: true, native: true }],
    });
    render(<SkillsSettings />);
    expect(await screen.findByText("subscription-audit")).toBeTruthy();
    expect(screen.queryByText("Custom")).toBeNull();
  });

  it("should list native skills under Built-in with no controls and no per-row badge", async () => {
    h.list.mockResolvedValue(populated);
    render(<SkillsSettings />);

    expect(await screen.findByText("subscription-audit")).toBeTruthy();
    // "Built-in" appears once — the section title; the rows carry no badge.
    expect(screen.getAllByText("Built-in")).toHaveLength(1);
    // No toggle, no remove for the native row.
    expect(screen.queryByRole("switch", { name: "subscription-audit" })).toBeNull();
    // Third-party rows keep their controls (one Remove per non-native valid row).
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    expect(removeButtons).toHaveLength(3);
  });

  it("should show the trust notice in the add dialog", async () => {
    render(<SkillsSettings />);
    // The section stays short; the warning sits where the risky action is.
    fireEvent.click(await screen.findByRole("button", { name: "Add skill" }));
    expect(await screen.findByText(/only add skills you trust/i)).toBeTruthy();
  });

  it("should not offer Show more when the description fits the two-line clamp", async () => {
    h.list.mockResolvedValue(populated);
    render(<SkillsSettings />);
    await screen.findByText("subscription-audit");
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
        skills: [
          {
            name: "wordy",
            description: `${"activation trigger words ".repeat(12)}the tail end nobody reads`,
            enabled: true,
          },
        ],
      });
      render(<SkillsSettings />);
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

  it("should list custom skills with source badges and toggles", async () => {
    h.list.mockResolvedValue(populated);
    render(<SkillsSettings />);

    expect(await screen.findByText("my-manual")).toBeTruthy();
    expect(screen.getAllByText("anthropics/skills").length).toBeGreaterThan(0);
    // Both source-less rows (manual drop + broken folder) carry the Manual badge.
    expect(screen.getAllByText("Manual")).toHaveLength(2);

    const pdfSwitch = screen.getByRole("switch", { name: "pdf" });
    expect(pdfSwitch.getAttribute("aria-checked")).toBe("true");
    const manualSwitch = screen.getByRole("switch", { name: "my-manual" });
    expect(manualSwitch.getAttribute("aria-checked")).toBe("false");
  });

  it("should surface a broken skill with its error and a disabled toggle", async () => {
    h.list.mockResolvedValue(populated);
    render(<SkillsSettings />);

    expect(await screen.findByText("Invalid")).toBeTruthy();
    expect(screen.getByText(/missing a description/)).toBeTruthy();
    // The toggle is inert for a broken skill — clicking must not reach the API.
    const badSwitch = screen.getByRole("switch", { name: "bad" });
    fireEvent.click(badSwitch);
    expect(h.setEnabled).not.toHaveBeenCalled();
  });

  it("should toggle a skill and restart the agent", async () => {
    h.list.mockResolvedValue(populated);
    render(<SkillsSettings />);

    const pdfSwitch = await screen.findByRole("switch", { name: "pdf" });
    fireEvent.click(pdfSwitch);

    await waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith("pdf", false));
    await waitFor(() => expect(h.restart).toHaveBeenCalled());
    // Optimistic flip — no reload needed for the switch state.
    expect(pdfSwitch.getAttribute("aria-checked")).toBe("false");
  });

  it("should remove a skill after confirmation, then restart and reload", async () => {
    h.list.mockResolvedValue(populated);
    render(<SkillsSettings />);

    const removeButtons = await screen.findAllByRole("button", { name: "Remove" });
    fireEvent.click(removeButtons[0]);

    // Nothing happens until the confirmation dialog's own Remove is clicked.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove pdf?")).toBeTruthy();
    expect(h.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith("pdf"));
    await waitFor(() => expect(h.restart).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("should not remove a skill when the confirmation is cancelled", async () => {
    h.list.mockResolvedValue(populated);
    render(<SkillsSettings />);

    const removeButtons = await screen.findAllByRole("button", { name: "Remove" });
    fireEvent.click(removeButtons[0]);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.restart).not.toHaveBeenCalled();
  });

  it("should open the add-skill dialog and install the pasted repo", async () => {
    render(<SkillsSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Add skill" }));

    const input = await screen.findByLabelText("GitHub repository");
    fireEvent.change(input, { target: { value: "badlogic/pi-skills" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add skill" }));

    await waitFor(() => expect(h.add).toHaveBeenCalledWith({ source: "badlogic/pi-skills" }));
    await waitFor(() => expect(h.restart).toHaveBeenCalled());
    // The dialog closes once the install lands.
    await waitFor(() => expect(screen.queryByLabelText("GitHub repository")).toBeNull());
  });

  it("should keep the add form mounted after close (unmounting mid-transition strands the forced backdrop)", async () => {
    const unsub = vi.fn();
    h.onEvent.mockResolvedValue(unsub);
    render(<SkillsSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Add skill" }));
    await screen.findByLabelText("GitHub repository");
    await waitFor(() => expect(h.onEvent).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByLabelText("GitHub repository")).toBeNull());
    // The form component itself stays in the tree — its progress subscription
    // is still alive. (Unmount-on-close is what blurred the whole window.)
    expect(unsub).not.toHaveBeenCalled();
  });

  it("should show a fresh form when the dialog is reopened after a failed install", async () => {
    h.add.mockResolvedValue({ type: "error", message: "Repository or ref not found: x/y" });
    render(<SkillsSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Add skill" }));

    fireEvent.change(await screen.findByLabelText("GitHub repository"), { target: { value: "x/y" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add skill" }));
    expect(await screen.findByText(/not found/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByLabelText("GitHub repository")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));

    const input = await screen.findByLabelText("GitHub repository");
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/not found/)).toBeNull();
  });

  it("should keep the URL dialog open and show the error when the add fails", async () => {
    h.add.mockResolvedValue({ type: "error", message: "Repository or ref not found: x/y" });
    render(<SkillsSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Add skill" }));

    fireEvent.change(await screen.findByLabelText("GitHub repository"), { target: { value: "x/y" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add skill" }));

    expect(await screen.findByText(/not found/)).toBeTruthy();
    expect(screen.getByLabelText("GitHub repository")).toBeTruthy();
    expect(h.restart).not.toHaveBeenCalled();
  });
});
