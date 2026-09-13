// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProviders } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary for the connect step.
const h = vi.hoisted(() => ({
  providers: vi.fn(),
  detectOllama: vi.fn(),
  models: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/rpc/api", () => ({
  agentApi: { restart: vi.fn(), onModelsChanged: vi.fn(() => () => {}) },
  authApi: {
    providers: h.providers,
    detectOllama: h.detectOllama,
    models: h.models,
    setKey: vi.fn(),
    addAllOllama: vi.fn(),
  },
  settingsApi: { get: h.get, set: vi.fn(async () => ({})), onChange: vi.fn(() => () => {}) },
}));
vi.mock("@/hooks/use-oauth-login", () => ({
  useOAuthLogin: () => ({
    active: null,
    log: [],
    request: null,
    authUrl: null,
    deviceCode: null,
    error: null,
    errorProvider: null,
    start: vi.fn(),
    respond: vi.fn(),
    cancel: vi.fn(),
    dismissError: vi.fn(),
  }),
}));

// The funnel events are the wizard's own side effect; assert them, don't send.
const analytics = vi.hoisted(() => ({
  trackOnboardingSetupViewed: vi.fn(),
  trackOnboardingCompleted: vi.fn(),
}));
vi.mock("@/lib/analyticsEvents", () => analytics);

import { Onboarding } from "../onboarding";

const CATALOG: AuthProviders = {
  type: "providers",
  oauth: [],
  all: [{ provider: "groq", displayName: "Groq", oauth: false, configured: false }],
};

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  h.providers.mockResolvedValue(CATALOG);
  h.detectOllama.mockResolvedValue({ type: "ollama", running: false, models: [] });
  h.models.mockResolvedValue({ type: "models", models: [], providerDefaults: {} });
  h.get.mockResolvedValue({});
});

afterEach(() => cleanup());

const getStarted = () => screen.getByRole("button", { name: "Get started" });

describe("Onboarding", () => {
  it("should open on the welcome step", () => {
    render(<Onboarding onDone={() => {}} />);
    expect(screen.getByRole("heading", { name: "Welcome to Accountant24" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
  });

  it("should move on to connecting a model", async () => {
    render(<Onboarding onDone={() => {}} />);
    fireEvent.click(getStarted());
    expect(screen.getByRole("heading", { name: "Connect an AI model" })).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    await waitFor(() => expect(h.providers).toHaveBeenCalled());
  });

  it("should record reaching the connect step, and nothing more", () => {
    render(<Onboarding onDone={() => {}} />);
    fireEvent.click(getStarted());
    expect(analytics.trackOnboardingSetupViewed).toHaveBeenCalledTimes(1);
    expect(analytics.trackOnboardingCompleted).not.toHaveBeenCalled();
  });

  it("should never open a dialog: every step lives on the page", async () => {
    render(<Onboarding onDone={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(getStarted());
    await screen.findByRole("combobox");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("should keep the window draggable by its top edge on every step", () => {
    const { container } = render(<Onboarding onDone={() => {}} />);
    expect(container.querySelector(".app-drag-region")).toBeInTheDocument();
    fireEvent.click(getStarted());
    expect(container.querySelector(".app-drag-region")).toBeInTheDocument();
  });
});
