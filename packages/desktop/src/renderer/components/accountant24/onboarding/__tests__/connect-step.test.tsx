// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProviders } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: the step reads the provider catalog, detects Ollama, and (via
// the connect hook) restarts the agent and adopts models after a connect.
const h = vi.hoisted(() => ({
  providers: vi.fn(),
  detectOllama: vi.fn(),
  models: vi.fn(),
  setKey: vi.fn(),
  addAllOllama: vi.fn(),
  restart: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  onModelsChanged: vi.fn(() => () => {}),
  onChange: vi.fn((_cb: () => void) => () => {}),
  // The real settingsApi tells listeners after every write; the fake store
  // below does the same, so what the UI shows follows what was written.
  settings: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
}));
vi.mock("@/rpc/api", () => ({
  agentApi: { restart: h.restart, onModelsChanged: h.onModelsChanged },
  authApi: {
    providers: h.providers,
    detectOllama: h.detectOllama,
    models: h.models,
    setKey: h.setKey,
    addAllOllama: h.addAllOllama,
  },
  settingsApi: { get: h.get, set: h.set, onChange: h.onChange },
}));

// The sign-in flow has its own suite; here it is idle unless a test says so.
const oauthMock = vi.hoisted(() => ({
  active: null as string | null,
  log: [] as string[],
  request: null,
  authUrl: null,
  deviceCode: null,
  error: null as string | null,
  errorProvider: null as string | null,
  onDone: null as ((provider: string) => void) | null,
  start: vi.fn(),
  respond: vi.fn(),
  cancel: vi.fn(),
  dismissError: vi.fn(),
}));
vi.mock("@/hooks/use-oauth-login", () => ({
  useOAuthLogin: (onDone: (provider: string) => void) => {
    oauthMock.onDone = onDone;
    return oauthMock;
  },
}));

import { ConnectStep } from "../connect-step";

const CATALOG: AuthProviders = {
  type: "providers",
  oauth: [{ id: "anthropic", name: "Anthropic (Claude Pro/Max)" }],
  all: [
    { provider: "anthropic", displayName: "Anthropic", oauth: true, configured: false },
    { provider: "groq", displayName: "Groq", oauth: false, configured: false },
  ],
};

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  oauthMock.active = null;
  oauthMock.error = null;
  oauthMock.errorProvider = null;
  oauthMock.onDone = null;
  h.providers.mockResolvedValue(CATALOG);
  h.detectOllama.mockResolvedValue({ type: "ollama", running: false, models: [] });
  h.models.mockResolvedValue({ type: "models", models: [], providerDefaults: {} });
  h.setKey.mockResolvedValue({ type: "done", provider: "groq" });
  h.addAllOllama.mockResolvedValue({ type: "done", provider: "ollama", count: 1 });
  h.restart.mockResolvedValue(undefined);
  h.settings = {};
  h.listeners.clear();
  h.get.mockImplementation(async () => h.settings);
  h.set.mockImplementation(async (patch: Record<string, unknown>) => {
    h.settings = { ...h.settings, ...patch };
    for (const listener of h.listeners) listener();
    return h.settings;
  });
  h.onChange.mockImplementation((cb: () => void) => {
    h.listeners.add(cb);
    return () => {
      h.listeners.delete(cb);
    };
  });
});

afterEach(() => cleanup());

/** Choose a provider from the one dropdown the step offers. */
const pickProvider = async (name: string | RegExp) => {
  fireEvent.click(await screen.findByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name }));
};

describe("ConnectStep", () => {
  it("should ask for a provider before anything else", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    expect(screen.getByRole("heading", { name: "Connect an AI model" })).toBeInTheDocument();
    expect(await screen.findByRole("combobox")).toHaveTextContent("Select a provider");
    // Nothing to do until a provider is chosen.
    expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("should still ask for a provider when the catalog cannot be read", async () => {
    h.providers.mockRejectedValue(new Error("offline"));
    render(<ConnectStep onOpen={() => {}} />);
    // The list is empty, but the step renders and says what it wants.
    expect(await screen.findByRole("combobox")).toHaveTextContent("Select a provider");
  });

  it("should offer the subscription first for a provider that has one", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Anthropic");
    expect(screen.getByRole("button", { name: "Sign in to Anthropic" })).toBeInTheDocument();
    expect(screen.getByText("Use your Anthropic (Claude Pro/Max) subscription.")).toBeInTheDocument();
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("should swap to the key field on request, and back", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Anthropic");
    fireEvent.click(screen.getByRole("button", { name: "Use an API key instead" }));
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign in with a subscription instead" }));
    expect(screen.getByRole("button", { name: "Sign in to Anthropic" })).toBeInTheDocument();
  });

  it("should ask for a key straight away when the provider has no subscription", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Groq");
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
  });

  it("should offer Ollama even before it has models registered", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    // The option carries a "Runs on this Mac" hint alongside the name.
    await pickProvider(/Ollama/);
    expect(await screen.findByText(/Ollama isn't running/)).toBeInTheDocument();
  });

  it("should start over when another provider is chosen", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Groq");
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test" } });
    await pickProvider("Anthropic");
    fireEvent.click(screen.getByRole("button", { name: "Use an API key instead" }));
    expect(screen.getByLabelText("API Key")).toHaveValue("");
  });

  it("should abort a running sign-in when another provider is chosen", async () => {
    oauthMock.active = "anthropic";
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Groq");
    expect(oauthMock.cancel).toHaveBeenCalledTimes(1);
  });

  it("should clear a failed sign-in when another provider is chosen", async () => {
    oauthMock.error = "Login cancelled";
    oauthMock.errorProvider = "anthropic";
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Groq");
    expect(oauthMock.dismissError).toHaveBeenCalledTimes(1);
    expect(oauthMock.cancel).not.toHaveBeenCalled();
  });

  it("should confirm the connection and the model once a key is accepted", async () => {
    h.models.mockResolvedValue({
      type: "models",
      models: [{ provider: "groq", id: "llama", name: "Llama 3" }],
      providerDefaults: {},
    });
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Groq");
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("heading", { name: "Connected to Groq" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("Llama 3"));
    expect(h.restart).toHaveBeenCalledTimes(1);
    expect(h.set).toHaveBeenCalledExactlyOnceWith({ defaultModel: "groq/llama" });
  });

  it("should confirm the connection when a sign-in completes", async () => {
    h.models.mockResolvedValue({
      type: "models",
      models: [{ provider: "anthropic", id: "claude", name: "Claude" }],
      providerDefaults: {},
    });
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Anthropic");
    await waitFor(() => expect(oauthMock.onDone).not.toBeNull());
    oauthMock.onDone?.("anthropic");
    expect(await screen.findByRole("heading", { name: "Connected to Anthropic" })).toBeInTheDocument();
  });

  it("should open the app from the confirmation", async () => {
    h.models.mockResolvedValue({
      type: "models",
      models: [{ provider: "groq", id: "llama", name: "Llama 3" }],
      providerDefaults: {},
    });
    const onOpen = vi.fn();
    render(<ConnectStep onOpen={onOpen} />);
    await pickProvider("Groq");
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    const open = await screen.findByRole("button", { name: "Open Accountant24" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
