// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: version for the info row, updateApi for the staged-update row,
// workspaceApi for the workspace row.
const h = vi.hoisted(() => ({
  version: vi.fn(),
  pending: vi.fn(),
  install: vi.fn(),
  onDownloaded: vi.fn(),
  workspaceDir: vi.fn(),
  openWorkspace: vi.fn(),
}));

vi.mock("@/rpc/api", () => ({
  appApi: { version: h.version },
  updateApi: { pending: h.pending, install: h.install, onDownloaded: h.onDownloaded },
  workspaceApi: { dir: h.workspaceDir, open: h.openWorkspace },
}));

import { AboutSettings } from "../about-settings";

beforeAll(() => {
  installJsdomPolyfills();
});

beforeEach(() => {
  h.version.mockResolvedValue("1.2.3");
  h.pending.mockResolvedValue(null);
  h.install.mockResolvedValue(undefined);
  h.onDownloaded.mockReturnValue(() => {});
  h.workspaceDir.mockResolvedValue("/home/user/.accountant24");
  h.openWorkspace.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AboutSettings", () => {
  it("should show the app version once it resolves", async () => {
    render(<AboutSettings />);
    expect(await screen.findByText("v1.2.3")).toBeInTheDocument();
  });

  it("should show no version text when fetching the version fails", async () => {
    h.version.mockRejectedValue(new Error("no version"));
    render(<AboutSettings />);
    await screen.findByText("Version");
    expect(screen.queryByText(/^v/)).toBeNull();
  });

  it("should link the version row to its release notes", async () => {
    render(<AboutSettings />);
    const link = await screen.findByRole("link", { name: "Version v1.2.3" });
    expect(link).toHaveAttribute("href", "https://github.com/machulav/accountant24/releases/tag/v1.2.3");
  });

  it("should link the version row to the releases list in dev builds", async () => {
    h.version.mockResolvedValue("0.0.0-dev");
    render(<AboutSettings />);
    const link = await screen.findByRole("link", { name: "Version v0.0.0-dev" });
    expect(link).toHaveAttribute("href", "https://github.com/machulav/accountant24/releases");
  });

  it("should link Documentation to the docs site", async () => {
    render(<AboutSettings />);
    const link = await screen.findByRole("link", { name: "Documentation" });
    expect(link).toHaveAttribute("href", "https://accountant24.ai");
  });

  it("should link Changelog to the releases page", async () => {
    render(<AboutSettings />);
    const link = await screen.findByRole("link", { name: "Changelog" });
    expect(link).toHaveAttribute("href", "https://github.com/machulav/accountant24/releases");
  });

  it("should link Report an issue to the GitHub issue tracker", async () => {
    render(<AboutSettings />);
    const link = await screen.findByRole("link", { name: "Report an issue" });
    expect(link).toHaveAttribute("href", "https://github.com/machulav/accountant24/issues");
  });

  it("should link Source code to the GitHub repository", async () => {
    render(<AboutSettings />);
    const link = await screen.findByRole("link", { name: "Source code" });
    expect(link).toHaveAttribute("href", "https://github.com/machulav/accountant24");
  });

  it("should link the Apache 2.0 license", async () => {
    render(<AboutSettings />);
    const link = await screen.findByRole("link", { name: "Apache 2.0 license" });
    expect(link).toHaveAttribute("href", "https://github.com/machulav/accountant24/blob/main/LICENSE");
  });

  it("should not show an update row when no update is staged", async () => {
    render(<AboutSettings />);
    await screen.findByText("v1.2.3");
    expect(screen.queryByRole("button", { name: "Relaunch to install" })).toBeNull();
  });

  it("should show the staged update version when one is pending", async () => {
    h.pending.mockResolvedValue("2.0.0");
    render(<AboutSettings />);
    expect(await screen.findByText("Update available: v2.0.0")).toBeInTheDocument();
  });

  it("should install the update when Relaunch to install is clicked", async () => {
    h.pending.mockResolvedValue("2.0.0");
    render(<AboutSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Relaunch to install" }));
    expect(h.install).toHaveBeenCalledTimes(1);
  });

  it("should show the workspace path once it resolves", async () => {
    render(<AboutSettings />);
    expect(await screen.findByText("/home/user/.accountant24")).toBeInTheDocument();
  });

  it("should open the workspace folder when the Workspace row is clicked", async () => {
    render(<AboutSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Workspace /home/user/.accountant24" }));
    expect(h.openWorkspace).toHaveBeenCalledTimes(1);
  });

  it("should keep the Workspace row usable when opening the folder fails", async () => {
    h.openWorkspace.mockRejectedValue(new Error("no finder"));
    render(<AboutSettings />);
    const row = await screen.findByRole("button", { name: "Workspace /home/user/.accountant24" });
    await userEvent.click(row);
    expect(h.openWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Workspace /home/user/.accountant24" })).toBeInTheDocument();
  });

  it("should still render the Workspace row when the path lookup fails", async () => {
    h.workspaceDir.mockRejectedValue(new Error("no workspace"));
    render(<AboutSettings />);
    await screen.findByText("v1.2.3");
    expect(screen.getByRole("button", { name: "Workspace" })).toBeInTheDocument();
  });
});
