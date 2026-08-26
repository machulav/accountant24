// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceEntry, PluginsEvent } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: the install dialog reads the repository then installs it over
// pluginsApi, and streams progress lines back over pluginsApi.onEvent.
// Uninstall is driven through the onRemove prop.
const h = vi.hoisted(() => ({
  inspect: vi.fn(),
  add: vi.fn(),
  onEvent: vi.fn(),
  eventCb: null as ((e: PluginsEvent) => void) | null,
  unsub: vi.fn(),
}));

vi.mock("@/rpc/api", () => ({
  pluginsApi: {
    inspect: h.inspect,
    add: h.add,
    onEvent: h.onEvent,
  },
}));

import { InstallPluginDialog, RemovePluginDialog } from "../plugin-dialogs";

beforeAll(() => {
  installJsdomPolyfills();
  // The dialog/alert-dialog machinery touches pointer-capture APIs jsdom omits.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
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
  h.eventCb = null;
  h.unsub = vi.fn();
  h.onEvent.mockImplementation(async (cb: (e: PluginsEvent) => void) => {
    h.eventCb = cb;
    return h.unsub;
  });
});

afterEach(() => {
  cleanup();
});

/** Emit a streamed progress line the way main does over plugins-event. */
const emitProgress = async (message: string) => {
  await waitFor(() => expect(h.eventCb).not.toBeNull());
  act(() => h.eventCb?.({ type: "progress", message }));
};

// ---- RemovePluginDialog --------------------------------------------------

describe("RemovePluginDialog", () => {
  it("should not render the dialog when no plugin is pending", () => {
    render(<RemovePluginDialog plugin={null} onClose={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByText("Uninstall plugin?")).not.toBeInTheDocument();
  });

  it("should ask the question and say what uninstalling does", () => {
    render(<RemovePluginDialog plugin="pdf-tools" onClose={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText("Uninstall plugin?")).toBeInTheDocument();
    expect(screen.getByText("The plugin folder will be removed from your workspace.")).toBeInTheDocument();
  });

  it("should remove the named plugin then close on confirm", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<RemovePluginDialog plugin="pdf-tools" onClose={onClose} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("pdf-tools"));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("should show a busy label while the removal is in flight", async () => {
    let resolve: () => void = () => {};
    const onRemove = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<RemovePluginDialog plugin="pdf-tools" onClose={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));

    expect(await screen.findByText("Uninstalling…")).toBeInTheDocument();
    act(() => resolve());
  });

  it("should close when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<RemovePluginDialog plugin="pdf-tools" onClose={onClose} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should close via onOpenChange when Escape is pressed", async () => {
    const onClose = vi.fn();
    render(<RemovePluginDialog plugin="pdf-tools" onClose={onClose} onRemove={vi.fn()} />);

    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ---- InstallPluginDialog --------------------------------------------------

describe("InstallPluginDialog", () => {
  const ENTRY: MarketplaceEntry = {
    repo: "acme/pdf-tools",
    repoUrl: "https://github.com/acme/pdf-tools",
    name: "pdf-tools",
    description: "Work with PDFs.",
    version: "1.2.0",
    author: "Acme Inc.",
    official: false,
    skills: [{ name: "pdf-tools:pdf", description: "Read, split, and OCR PDFs." }],
  };
  const official = (): MarketplaceEntry => ({ ...ENTRY, repo: "accountant24/skills", official: true });

  it("should not render the dialog when no plugin is being installed", () => {
    render(<InstallPluginDialog entry={null} onClose={vi.fn()} onInstalled={vi.fn()} />);
    expect(screen.queryByText("Install plugin?")).not.toBeInTheDocument();
  });

  it("should show the row the user clicked, without reading the repository", () => {
    render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);

    expect(screen.getByText("Install plugin?")).toBeInTheDocument();
    expect(screen.getByText("pdf-tools")).toBeInTheDocument();
    expect(screen.getByText("Work with PDFs.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "acme/pdf-tools" })).toHaveAttribute(
      "href",
      "https://github.com/acme/pdf-tools",
    );
    expect(h.inspect).not.toHaveBeenCalled();
  });

  it("should show nothing but the row: no author line, no skill list", () => {
    render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);

    expect(screen.queryByText(/Acme Inc\./)).not.toBeInTheDocument();
    expect(screen.queryByText("pdf-tools:pdf")).not.toBeInTheDocument();
  });

  it("should describe a plugin by its first skill when the listing has no description", () => {
    render(<InstallPluginDialog entry={{ ...ENTRY, description: "" }} onClose={vi.fn()} onInstalled={vi.fn()} />);
    expect(screen.getByText("Read, split, and OCR PDFs.")).toBeInTheDocument();
  });

  it("should warn, in an alert, that a community plugin is unreviewed", () => {
    render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not reviewed by Accountant24");
  });

  it("should not warn about a plugin Accountant24 published, and mark it Official", () => {
    render(<InstallPluginDialog entry={official()} onClose={vi.fn()} onInstalled={vi.fn()} />);

    expect(screen.queryByText(/Not reviewed/)).not.toBeInTheDocument();
    expect(screen.getByText("Official")).toBeInTheDocument();
  });

  it("should leave Install unfocused, so a stray Enter installs nothing", () => {
    render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Install" })).not.toHaveFocus();
  });

  it("should read the repository and install it when Install is clicked", async () => {
    const onInstalled = vi.fn();
    const onClose = vi.fn();
    render(<InstallPluginDialog entry={ENTRY} onClose={onClose} onInstalled={onInstalled} />);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => expect(h.inspect).toHaveBeenCalledWith({ source: "acme/pdf-tools" }));
    await waitFor(() => expect(h.add).toHaveBeenCalledTimes(1));
    expect(h.add).toHaveBeenCalledWith();
    await waitFor(() => expect(onInstalled).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("should show a busy label and the streamed progress while it installs", async () => {
    h.inspect.mockReturnValue(new Promise(() => {}));
    render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await emitProgress("Downloading acme/pdf-tools…");

    expect(screen.getByText("Downloading acme/pdf-tools…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Installing/ })).toBeDisabled();
  });

  it("should stay open with the error when the repository cannot be read", async () => {
    h.inspect.mockResolvedValue({ type: "error", message: "Repository not found: acme/pdf-tools" });
    const onClose = vi.fn();
    render(<InstallPluginDialog entry={ENTRY} onClose={onClose} onInstalled={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(await screen.findByText(/not found/)).toBeInTheDocument();
    expect(h.add).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("should stay open with the error when the install itself fails", async () => {
    h.add.mockResolvedValue({
      type: "error",
      message: "A plugin folder named pdf-tools is already in your workspace.",
    });
    render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(await screen.findByText(/already in your workspace/)).toBeInTheDocument();
  });

  it("should fall back to a generic message when a failure carries none", async () => {
    h.add.mockResolvedValue({ type: "error" });
    render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(await screen.findByText(/Failed to install the plugin/)).toBeInTheDocument();
  });

  it("should fall back to a generic message when the read carries none", async () => {
    h.inspect.mockResolvedValue({ type: "error" });
    render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(await screen.findByText(/Failed to read the plugin/)).toBeInTheDocument();
  });

  it("should install nothing when the repository holds a different plugin than the one shown", async () => {
    // The index is rebuilt every half hour, so the row can name a plugin the
    // repository has since renamed. Installing anyway would put something in
    // the workspace that the user never approved.
    h.inspect.mockResolvedValue({
      type: "plugin",
      plugin: {
        name: "crypto-miner",
        description: "Not what was listed.",
        repo: "acme/pdf-tools",
        repoUrl: "https://github.com/acme/pdf-tools",
        skills: [],
      },
    });
    const onClose = vi.fn();
    const onInstalled = vi.fn();
    render(<InstallPluginDialog entry={ENTRY} onClose={onClose} onInstalled={onInstalled} />);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(await screen.findByText(/now holds a plugin named crypto-miner, not pdf-tools/)).toBeInTheDocument();
    expect(h.add).not.toHaveBeenCalled();
    expect(onInstalled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("should close when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<InstallPluginDialog entry={ENTRY} onClose={onClose} onInstalled={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should close via onOpenChange when Escape is pressed", async () => {
    const onClose = vi.fn();
    render(<InstallPluginDialog entry={ENTRY} onClose={onClose} onInstalled={vi.fn()} />);

    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("should unsubscribe from the progress stream on unmount", async () => {
    const { unmount } = render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);
    await waitFor(() => expect(h.onEvent).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(h.unsub).toHaveBeenCalled());
  });

  it("should drop a progress subscription that arrives after unmount", async () => {
    let resolve: (u: () => void) => void = () => {};
    h.onEvent.mockReturnValue(new Promise<() => void>((r) => (resolve = r)));
    const { unmount } = render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);
    unmount();

    resolve(h.unsub);

    await waitFor(() => expect(h.unsub).toHaveBeenCalled());
  });

  it("should still render when the progress stream fails to subscribe", async () => {
    h.onEvent.mockRejectedValue(new Error("no bridge"));
    render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
  });
});

describe("InstallPluginDialog, when the user moves on mid-install", () => {
  const ENTRY: MarketplaceEntry = {
    repo: "acme/pdf-tools",
    repoUrl: "https://github.com/acme/pdf-tools",
    name: "pdf-tools",
    description: "Work with PDFs.",
    official: false,
    skills: [{ name: "pdf-tools:pdf", description: "Read, split, and OCR PDFs." }],
  };

  it("should not install the plugin whose dialog was cancelled", async () => {
    let release: (v: unknown) => void = () => {};
    h.inspect.mockReturnValueOnce(new Promise((r) => (release = r)));
    const onInstalled = vi.fn();
    const { rerender } = render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={onInstalled} />);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    // The user cancels and opens the dialog for another plugin.
    rerender(<InstallPluginDialog entry={null} onClose={vi.fn()} onInstalled={onInstalled} />);
    rerender(
      <InstallPluginDialog
        entry={{ ...ENTRY, name: "other-plugin", repo: "someone/other" }}
        onClose={vi.fn()}
        onInstalled={onInstalled}
      />,
    );
    await act(async () => {
      release({ type: "plugin", plugin: { name: ENTRY.name, repo: ENTRY.repo, repoUrl: ENTRY.repoUrl, skills: [] } });
    });

    expect(h.add).not.toHaveBeenCalled();
    expect(onInstalled).not.toHaveBeenCalled();
  });

  it("should keep the second dialog open and idle", async () => {
    let release: (v: unknown) => void = () => {};
    h.inspect.mockReturnValueOnce(new Promise((r) => (release = r)));
    const { rerender } = render(<InstallPluginDialog entry={ENTRY} onClose={vi.fn()} onInstalled={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    rerender(<InstallPluginDialog entry={null} onClose={vi.fn()} onInstalled={vi.fn()} />);
    rerender(
      <InstallPluginDialog
        entry={{ ...ENTRY, name: "other-plugin", repo: "someone/other" }}
        onClose={vi.fn()}
        onInstalled={vi.fn()}
      />,
    );
    await act(async () => {
      release({ type: "error", message: "boom" });
    });

    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeEnabled();
  });
});
