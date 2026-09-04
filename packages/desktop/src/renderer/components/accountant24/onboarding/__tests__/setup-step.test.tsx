// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStatus, ModelInfo } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: the step embeds the providers list (auth + agent restart) and
// reads the model list and settings for the default-model picker.
const h = vi.hoisted(() => ({
  status: vi.fn(),
  detectOllama: vi.fn(),
  models: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@/rpc/api", () => ({
  agentApi: { restart: vi.fn(), onModelsChanged: vi.fn(() => () => {}) },
  authApi: {
    status: h.status,
    detectOllama: h.detectOllama,
    models: h.models,
    setKey: vi.fn(),
    logout: vi.fn(),
    removeOllama: vi.fn(),
    addAllOllama: vi.fn(),
  },
  settingsApi: { get: h.get, set: h.set, onChange: vi.fn(() => () => {}) },
}));

// The interactive OAuth flow has its own suite; an idle stub is enough here.
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

import { SetupStep } from "../setup-step";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const STATUS: AuthStatus = {
  type: "status",
  providers: [{ provider: "anthropic", displayName: "Anthropic", oauth: true, configured: false }],
  availableModels: 0,
  anyConfigured: false,
};

const MODELS: ModelInfo[] = [
  { provider: "anthropic", id: "claude-fable", name: "Claude Fable 5" },
  { provider: "openai", id: "gpt-5", name: "GPT-5" },
];
const FABLE = "anthropic/claude-fable";
const GPT = "openai/gpt-5";

beforeEach(() => {
  h.status.mockResolvedValue(STATUS);
  h.detectOllama.mockResolvedValue({ type: "ollama", running: false, models: [] });
  h.models.mockResolvedValue({ type: "models", models: [], providerDefaults: {} });
  h.get.mockResolvedValue({});
  h.set.mockResolvedValue({});
});

afterEach(() => cleanup());

const startButton = () => screen.getByRole("button", { name: "Start" });

const withModels = (defaultModel?: string) => {
  h.models.mockResolvedValue({ type: "models", models: MODELS, providerDefaults: {} });
  h.get.mockResolvedValue(defaultModel ? { defaultModel } : {});
};

const openPicker = async () => {
  fireEvent.click(await screen.findByRole("combobox"));
  await screen.findByPlaceholderText("Search models");
};

describe("SetupStep", () => {
  it("should embed the provider list", async () => {
    render(<SetupStep onStart={() => {}} />);
    expect(await screen.findByText("Anthropic")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "API Key" })).toBeInTheDocument();
  });

  it("should say what to do while no model exists, with Start disabled", async () => {
    render(<SetupStep onStart={() => {}} />);
    expect(await screen.findByText("Connect a provider to choose a default model.")).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it("should show the stored default model without writing anything", async () => {
    withModels(GPT);
    render(<SetupStep onStart={() => {}} />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("GPT-5"));
    expect(h.set).not.toHaveBeenCalled();
  });

  it("should enable Start once a model exists", async () => {
    withModels(GPT);
    render(<SetupStep onStart={() => {}} />);
    await waitFor(() => expect(startButton()).toBeEnabled());
  });

  it("should write the pick when another default is chosen", async () => {
    withModels(GPT);
    render(<SetupStep onStart={() => {}} />);
    await openPicker();
    fireEvent.click(screen.getByRole("option", { name: /Claude Fable 5/ }));
    await waitFor(() => expect(h.set).toHaveBeenCalledExactlyOnceWith({ defaultModel: FABLE }));
    // The picker's trigger is the first combobox; the open popup's search box is another.
    expect(screen.getAllByRole("combobox")[0]).toHaveTextContent("Claude Fable 5");
  });

  it("should show an error when the pick cannot be saved", async () => {
    withModels(GPT);
    h.set.mockRejectedValue(new Error("disk full"));
    render(<SetupStep onStart={() => {}} />);
    await openPicker();
    fireEvent.click(screen.getByRole("option", { name: /Claude Fable 5/ }));
    expect(await screen.findByText("Couldn’t save settings: disk full")).toBeInTheDocument();
  });

  it("should call onStart when Start is clicked", async () => {
    withModels(GPT);
    const onStart = vi.fn();
    render(<SetupStep onStart={onStart} />);
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(startButton());
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
