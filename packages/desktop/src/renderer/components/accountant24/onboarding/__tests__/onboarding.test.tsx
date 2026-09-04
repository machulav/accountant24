// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStatus } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary for the setup step (providers list + model picker).
const h = vi.hoisted(() => ({
  status: vi.fn(),
  models: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/rpc/api", () => ({
  agentApi: { restart: vi.fn(), onModelsChanged: vi.fn(() => () => {}) },
  authApi: {
    status: h.status,
    detectOllama: vi.fn(async () => ({ type: "ollama", running: false, models: [] })),
    models: h.models,
    setKey: vi.fn(),
    logout: vi.fn(),
    removeOllama: vi.fn(),
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

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

const STATUS: AuthStatus = {
  type: "status",
  providers: [{ provider: "anthropic", displayName: "Anthropic", oauth: true, configured: false }],
  availableModels: 0,
  anyConfigured: false,
};

beforeEach(() => {
  h.status.mockResolvedValue(STATUS);
  h.models.mockResolvedValue({ type: "models", models: [], providerDefaults: {} });
  h.get.mockResolvedValue({});
});

afterEach(() => cleanup());

const getStarted = () => screen.getByRole("button", { name: "Get started" });

describe("Onboarding", () => {
  it("should open on the welcome page", () => {
    render(<Onboarding onDone={() => {}} />);
    expect(screen.getByRole("heading", { name: "Accountant24" })).toBeInTheDocument();
    expect(getStarted()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("should not render any dialog on the welcome page", () => {
    render(<Onboarding onDone={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("should move to the provider setup when Get started is clicked", async () => {
    render(<Onboarding onDone={() => {}} />);
    fireEvent.click(getStarted());
    expect(screen.getByRole("heading", { name: "Connect a provider" })).toBeInTheDocument();
    expect(await screen.findByText("Anthropic")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get started" })).not.toBeInTheDocument();
  });

  it("should record the setup step being reached, once", () => {
    render(<Onboarding onDone={() => {}} />);
    fireEvent.click(getStarted());
    expect(analytics.trackOnboardingSetupViewed).toHaveBeenCalledTimes(1);
    expect(analytics.trackOnboardingCompleted).not.toHaveBeenCalled();
  });

  it("should finish (onDone + completed event) when Start is clicked with a model", async () => {
    h.models.mockResolvedValue({
      type: "models",
      models: [{ provider: "openai", id: "gpt-5", name: "GPT-5" }],
      providerDefaults: {},
    });
    h.get.mockResolvedValue({ defaultModel: "openai/gpt-5" });
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);
    fireEvent.click(getStarted());

    const start = screen.getByRole("button", { name: "Start" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(analytics.trackOnboardingCompleted).toHaveBeenCalledTimes(1);
  });

  it("should keep the window draggable by its top edge on every step", () => {
    const { container } = render(<Onboarding onDone={() => {}} />);
    expect(container.querySelector(".app-drag-region")).toBeInTheDocument();
    fireEvent.click(getStarted());
    expect(container.querySelector(".app-drag-region")).toBeInTheDocument();
  });
});
