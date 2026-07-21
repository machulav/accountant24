// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary. The panes the shell mounts (Providers by default) reach for
// authApi/settingsApi/agentApi — and About for appApi/updateApi — so the whole
// surface is stubbed. Providers is kept in its loading state (status never
// resolves) so these tests exercise only the shell, not the provider list.
const h = vi.hoisted(() => ({
  version: vi.fn(),
  status: vi.fn(),
  detectOllama: vi.fn(),
  models: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  restart: vi.fn(),
  skillsList: vi.fn(),
  updatePending: vi.fn(),
}));

vi.mock("@/rpc/api", () => ({
  appApi: { version: h.version },
  updateApi: { pending: h.updatePending, install: vi.fn(), onDownloaded: vi.fn(() => () => {}) },
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
  skillsApi: {
    list: h.skillsList,
    add: vi.fn(),
    remove: vi.fn(),
    setEnabled: vi.fn(),
    onEvent: vi.fn(async () => () => {}),
  },
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
  h.skillsList.mockResolvedValue({ skills: [] });
  h.updatePending.mockResolvedValue(null);
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
    for (const label of ["Providers", "Models", "Privacy", "Shortcuts", "About"]) {
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

  it("should swap to the Skills pane when Skills is clicked", async () => {
    renderSettings(true);
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(await screen.findByText("Add from GitHub repository")).toBeInTheDocument();
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

  it("should swap to the About pane when About is clicked", async () => {
    renderSettings(true);
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(await screen.findByRole("link", { name: "Documentation" })).toBeInTheDocument();
    expect(screen.queryByText("Loading providers…")).toBeNull();
  });

  it("should link the sidebar star callout to the GitHub repository", () => {
    renderSettings(true);
    const link = screen.getByRole("link", { name: /Enjoying the app\?/ });
    expect(link).toHaveAttribute("href", "https://github.com/machulav/accountant24");
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
