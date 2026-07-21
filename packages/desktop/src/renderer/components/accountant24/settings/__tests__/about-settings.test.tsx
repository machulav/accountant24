// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: version for the info row, updateApi for the staged-update row.
const h = vi.hoisted(() => ({
  version: vi.fn(),
  pending: vi.fn(),
  install: vi.fn(),
  onDownloaded: vi.fn(),
}));

vi.mock("@/rpc/api", () => ({
  appApi: { version: h.version },
  updateApi: { pending: h.pending, install: h.install, onDownloaded: h.onDownloaded },
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

  it("should link the MIT license", async () => {
    render(<AboutSettings />);
    const link = await screen.findByRole("link", { name: "MIT license" });
    expect(link).toHaveAttribute("href", "https://github.com/machulav/accountant24/blob/main/LICENSE");
  });

  it("should not show an update row when no update is staged", async () => {
    render(<AboutSettings />);
    await screen.findByText("v1.2.3");
    expect(screen.queryByRole("button", { name: "Relaunch to update" })).toBeNull();
  });

  it("should show the staged update version when one is pending", async () => {
    h.pending.mockResolvedValue("2.0.0");
    render(<AboutSettings />);
    expect(await screen.findByText("Update ready: v2.0.0")).toBeInTheDocument();
  });

  it("should install the update when Relaunch to update is clicked", async () => {
    h.pending.mockResolvedValue("2.0.0");
    render(<AboutSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Relaunch to update" }));
    expect(h.install).toHaveBeenCalledTimes(1);
  });
});
