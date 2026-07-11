// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary. The shell reads the app version through appApi; the panes it
// mounts (Providers by default) reach for authApi/settingsApi/agentApi, so the
// whole surface is stubbed. Providers is kept in its loading state (status never
// resolves) so these tests exercise only the shell, not the provider list.
const h = vi.hoisted(() => ({
  version: vi.fn(),
  status: vi.fn(),
  detectOllama: vi.fn(),
  models: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  restart: vi.fn(),
}));

vi.mock("@/rpc/api", () => ({
  appApi: { version: h.version },
  authApi: {
    status: h.status,
    detectOllama: h.detectOllama,
    models: h.models,
    logout: vi.fn(),
    removeOllama: vi.fn(),
    addAllOllama: vi.fn(),
  },
  settingsApi: { get: h.get, set: h.set, onChange: vi.fn(() => () => {}) },
  agentApi: { restart: h.restart, onModelsChanged: vi.fn(() => () => {}) },
}));

import { Settings } from "../settings";

beforeAll(() => {
  installJsdomPolyfills();
  // The Dialog + Sidebar machinery touches pointer-capture APIs jsdom omits.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  h.version.mockResolvedValue("1.2.3");
  // Never resolves: keep Providers in "Loading providers…" so the shell tests
  // don't depend on the provider list's contents.
  h.status.mockReturnValue(new Promise(() => {}));
  h.detectOllama.mockResolvedValue({ type: "ollama", running: false, models: [] });
  h.models.mockResolvedValue({ type: "models", models: [] });
  h.get.mockResolvedValue({});
  h.set.mockResolvedValue({});
  h.restart.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

const renderSettings = (open = true) => {
  const onOpenChange = vi.fn();
  render(<Settings open={open} onOpenChange={onOpenChange} />);
  return onOpenChange;
};

describe("Settings shell", () => {
  it("should render every category in the nav when open", () => {
    renderSettings(true);
    for (const label of ["Providers", "Models", "Privacy", "Shortcuts"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("should render nothing when open is false", () => {
    renderSettings(false);
    expect(screen.queryByRole("button", { name: "Providers" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Models" })).toBeNull();
  });

  it("should show the Providers pane first", () => {
    renderSettings(true);
    expect(screen.getByText("Loading providers…")).toBeInTheDocument();
  });

  it("should swap to the Models pane when Models is clicked", async () => {
    renderSettings(true);
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(await screen.findByText("Default model")).toBeInTheDocument();
    expect(screen.queryByText("Loading providers…")).toBeNull();
  });

  it("should swap to the Privacy pane when Privacy is clicked", async () => {
    renderSettings(true);
    fireEvent.click(screen.getByRole("button", { name: "Privacy" }));
    expect(await screen.findByText("Analytics")).toBeInTheDocument();
    expect(screen.queryByText("Loading providers…")).toBeNull();
  });

  it("should swap to the Shortcuts pane when Shortcuts is clicked", async () => {
    renderSettings(true);
    fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
    expect(await screen.findByText("Keyboard shortcuts")).toBeInTheDocument();
    expect(screen.queryByText("Loading providers…")).toBeNull();
  });

  it("should swap back to the Providers pane after leaving it", async () => {
    renderSettings(true);
    fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
    await screen.findByText("Keyboard shortcuts");
    fireEvent.click(screen.getByRole("button", { name: "Providers" }));
    expect(await screen.findByText("Loading providers…")).toBeInTheDocument();
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
  });
});

describe("Settings version footer", () => {
  it("should show the version once appApi.version resolves", async () => {
    renderSettings(true);
    expect(await screen.findByText("v1.2.3")).toBeInTheDocument();
  });

  it("should link the Changelog to the releases page", async () => {
    renderSettings(true);
    const link = await screen.findByRole("link", { name: "Changelog" });
    expect(link).toHaveAttribute("href", "https://github.com/machulav/accountant24/releases");
  });

  it("should not show a version footer when the version never resolves", async () => {
    h.version.mockReturnValue(new Promise(() => {}));
    renderSettings(true);
    // The nav renders immediately; the footer is gated on the version.
    await screen.findByRole("button", { name: "Providers" });
    expect(screen.queryByRole("link", { name: "Changelog" })).toBeNull();
  });
});
