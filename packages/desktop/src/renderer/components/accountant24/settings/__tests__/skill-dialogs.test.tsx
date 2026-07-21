// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillsEvent } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: the add-skill dialog adds over skillsApi and streams progress
// lines back over skillsApi.onEvent. Remove is driven through the onRemove prop.
const h = vi.hoisted(() => ({
  add: vi.fn(),
  onEvent: vi.fn(),
  eventCb: null as ((e: SkillsEvent) => void) | null,
  unsub: vi.fn(),
}));

vi.mock("@/rpc/api", () => ({
  skillsApi: {
    add: h.add,
    onEvent: h.onEvent,
  },
}));

import { AddSkillDialog, RemoveSkillDialog } from "../skill-dialogs";

beforeAll(() => {
  installJsdomPolyfills();
  // The dialog/alert-dialog machinery touches pointer-capture APIs jsdom omits.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  h.add.mockResolvedValue({ type: "done", added: ["pdf"] });
  h.eventCb = null;
  h.unsub = vi.fn();
  h.onEvent.mockImplementation(async (cb: (e: SkillsEvent) => void) => {
    h.eventCb = cb;
    return h.unsub;
  });
});

afterEach(() => {
  cleanup();
});

/** Emit a streamed progress line the way main does over skills-event. */
const emitProgress = async (message: string) => {
  await waitFor(() => expect(h.eventCb).not.toBeNull());
  act(() => h.eventCb?.({ type: "progress", message }));
};

// ---- RemoveSkillDialog --------------------------------------------------

describe("RemoveSkillDialog", () => {
  it("should not render the dialog when no skill is pending", () => {
    render(<RemoveSkillDialog skill={null} onClose={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByText(/Remove/)).not.toBeInTheDocument();
  });

  it("should name the skill in the confirmation prompt when open", () => {
    render(<RemoveSkillDialog skill="pdf" onClose={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Remove pdf?")).toBeInTheDocument();
  });

  it("should remove the named skill then close on confirm", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<RemoveSkillDialog skill="pdf" onClose={onClose} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("pdf"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("should show a busy label while the removal is in flight", async () => {
    let resolve: () => void = () => {};
    const onRemove = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<RemoveSkillDialog skill="pdf" onClose={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Removing…")).toBeInTheDocument();
    act(() => resolve());
  });

  it("should close via onOpenChange when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<RemoveSkillDialog skill="pdf" onClose={onClose} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---- AddSkillDialog -----------------------------------------------------

describe("AddSkillDialog", () => {
  it("should not render the dialog content when closed", () => {
    render(<AddSkillDialog open={false} onClose={vi.fn()} onAdded={vi.fn()} />);
    expect(screen.queryByText("Add skills from GitHub repository")).not.toBeInTheDocument();
  });

  it("should show the title and trust warning when open", () => {
    render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    expect(screen.getByText("Add skills from GitHub repository")).toBeInTheDocument();
    expect(screen.getByText("Only add skills you trust")).toBeInTheDocument();
  });

  it("should disable Add skill until a repository is entered", () => {
    render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add skill" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("GitHub repository"), { target: { value: "owner/repo" } });
    expect(screen.getByRole("button", { name: "Add skill" })).toBeEnabled();
  });

  it("should keep Add skill disabled for a whitespace-only repository", () => {
    render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("GitHub repository"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Add skill" })).toBeDisabled();
  });

  it("should add the trimmed source then notify and close on success", async () => {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(<AddSkillDialog open onClose={onClose} onAdded={onAdded} />);
    fireEvent.change(screen.getByLabelText("GitHub repository"), { target: { value: "  owner/repo  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));

    await waitFor(() => expect(h.add).toHaveBeenCalledWith({ source: "owner/repo" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should add when Enter is pressed in the repository field", async () => {
    render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    const input = screen.getByLabelText("GitHub repository");
    fireEvent.change(input, { target: { value: "owner/repo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(h.add).toHaveBeenCalledWith({ source: "owner/repo" }));
  });

  it("should ignore Enter while the repository is empty", () => {
    render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText("GitHub repository"), { key: "Enter" });
    expect(h.add).not.toHaveBeenCalled();
  });

  it("should surface an error result's message and not close", async () => {
    h.add.mockResolvedValue({ type: "error", message: "Repo not found" });
    const onAdded = vi.fn();
    const onClose = vi.fn();
    render(<AddSkillDialog open onClose={onClose} onAdded={onAdded} />);
    fireEvent.change(screen.getByLabelText("GitHub repository"), { target: { value: "owner/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));

    // The page carries two Alerts (the trust warning + this error), so match by text.
    await waitFor(() => expect(screen.getByText(/Repo not found/)).toBeInTheDocument());
    expect(onAdded).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("should fall back to a generic message when an error result carries none", async () => {
    h.add.mockResolvedValue({ type: "error" });
    render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("GitHub repository"), { target: { value: "owner/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    await waitFor(() => expect(screen.getByText(/Failed to add skill/)).toBeInTheDocument());
  });

  it("should render streamed progress lines as they arrive", async () => {
    render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    await emitProgress("Cloning repository…");
    await emitProgress("Installing skill…");
    expect(screen.getByText("Cloning repository…")).toBeInTheDocument();
    expect(screen.getByText("Installing skill…")).toBeInTheDocument();
  });

  it("should show a busy label while an add runs and stream its progress", async () => {
    let resolve: (v: { type: string }) => void = () => {};
    h.add.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("GitHub repository"), { target: { value: "owner/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));

    expect(await screen.findByText("Adding…")).toBeInTheDocument();
    await emitProgress("Step one");
    await emitProgress("Step two");
    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.getByText("Step two")).toBeInTheDocument();
    act(() => resolve({ type: "done" }));
  });

  it("should reset the form on each reopening", async () => {
    h.add.mockResolvedValue({ type: "error", message: "Boom" });
    const { rerender } = render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("GitHub repository"), { target: { value: "owner/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    await waitFor(() => expect(screen.getByText(/Boom/)).toBeInTheDocument());

    rerender(<AddSkillDialog open={false} onClose={vi.fn()} onAdded={vi.fn()} />);
    rerender(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    expect(screen.queryByText(/Boom/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("GitHub repository")).toHaveValue("");
  });

  it("should unsubscribe from the progress stream on unmount", async () => {
    const { unmount } = render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    await waitFor(() => expect(h.eventCb).not.toBeNull());
    unmount();
    expect(h.unsub).toHaveBeenCalledTimes(1);
  });

  it("should close when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<AddSkillDialog open onClose={onClose} onAdded={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should close via onOpenChange when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<AddSkillDialog open onClose={onClose} onAdded={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText("GitHub repository"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should still render when the progress stream fails to subscribe", async () => {
    h.onEvent.mockRejectedValue(new Error("no stream"));
    render(<AddSkillDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    // The form is usable even though the progress subscription never came up.
    expect(await screen.findByLabelText("GitHub repository")).toBeInTheDocument();
  });
});
