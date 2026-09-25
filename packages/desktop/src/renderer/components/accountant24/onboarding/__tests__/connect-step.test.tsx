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
  oauth: [
    { id: "anthropic", name: "Anthropic (Claude Pro/Max)", apiKey: true },
    { id: "openai-codex", name: "OpenAI (ChatGPT Plus/Pro)", apiKey: false },
  ],
  // Alphabetical, as pi lists them: the step is expected to reorder.
  all: [
    { provider: "amazon-bedrock", displayName: "Amazon Bedrock", oauth: false, configured: false },
    { provider: "anthropic", displayName: "Anthropic", oauth: true, configured: false },
    { provider: "groq", displayName: "Groq", oauth: false, configured: false },
    { provider: "openai-codex", displayName: "OpenAI Codex", oauth: true, configured: false },
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
  oauthMock.log = [];
  oauthMock.error = null;
  oauthMock.errorProvider = null;
  oauthMock.onDone = null;
  oauthMock.start.mockReset();
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

/** Swap the sign-in buttons for the full list, when the page opened on them. */
const openList = async () => {
  const link = () => screen.queryByRole("button", { name: "Use another provider" });
  await waitFor(() => {
    if (!link() && !screen.queryByRole("combobox")) throw new Error("catalog not loaded yet");
  });
  const button = link();
  if (button) fireEvent.click(button);
  return screen.findByRole("combobox");
};

/** Choose a provider from the list. */
const pickProvider = async (name: string | RegExp) => {
  fireEvent.click(await openList());
  fireEvent.click(await screen.findByRole("option", { name }));
};

/** The provider names in the open dropdown, top to bottom. */
const optionNames = () =>
  screen.getAllByRole("option").map((el) => el.querySelector(".truncate")?.textContent ?? el.textContent);

describe("ConnectStep", () => {
  it("should open on the two subscriptions people already have, and nothing else to fill in", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    expect(screen.getByRole("heading", { name: "Which AI do you use?" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sign in with ChatGPT" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Claude" })).toBeInTheDocument();
    expect(
      screen.getByText("Your plan runs the model. Accountant24 gets no access to your chats."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use another provider" })).toBeInTheDocument();
    // The long list stays out of the way until asked for.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("should start the sign-in straight from a subscription button", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Claude" }));
    expect(oauthMock.start).toHaveBeenCalledExactlyOnceWith("anthropic");
  });

  it("should show the running sign-in in place of the buttons", async () => {
    oauthMock.start.mockImplementation((id: string) => {
      oauthMock.active = id;
      oauthMock.log = ["Opened your browser to authorize."];
    });
    render(<ConnectStep onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with ChatGPT" }));
    expect(await screen.findByText("Opened your browser to authorize.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with ChatGPT" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use another provider" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("should swap the buttons for the full list on request", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use another provider" }));
    expect(await screen.findByRole("combobox")).toHaveTextContent("Select a provider");
    expect(screen.queryByRole("button", { name: "Sign in with Claude" })).toBeNull();
    // Nothing to do until a provider is chosen.
    expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("should go straight to the list when neither subscription is on offer", async () => {
    h.providers.mockResolvedValue({
      type: "providers",
      oauth: [],
      all: [{ provider: "groq", displayName: "Groq", oauth: false, configured: false }],
    });
    render(<ConnectStep onOpen={() => {}} />);
    expect(await screen.findByRole("combobox")).toHaveTextContent("Select a provider");
    expect(screen.queryByRole("button", { name: "Use another provider" })).toBeNull();
  });

  it("should list ChatGPT and Claude first, then the rest alphabetically, Ollama among them", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    fireEvent.click(await openList());
    await screen.findByRole("option", { name: /ChatGPT/ });
    expect(optionNames()).toEqual(["ChatGPT", "Claude", "Amazon Bedrock", "Groq", "Ollama"]);
    expect(document.querySelectorAll('[data-slot="combobox-separator"]')).toHaveLength(1);
  });

  it("should name the company behind each featured product, and nothing about Ollama", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    fireEvent.click(await openList());
    expect(await screen.findByText("OpenAI, uses your ChatGPT subscription")).toBeInTheDocument();
    expect(screen.getByText("Anthropic, uses your Claude subscription")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ollama" })).toBeInTheDocument();
  });

  it("should keep the list flat when the catalog has neither featured product", async () => {
    h.providers.mockResolvedValue({
      type: "providers",
      oauth: [],
      all: [{ provider: "groq", displayName: "Groq", oauth: false, configured: false }],
    });
    render(<ConnectStep onOpen={() => {}} />);
    fireEvent.click(await openList());
    await screen.findByRole("option", { name: "Ollama" });
    expect(optionNames()).toEqual(["Groq", "Ollama"]);
    expect(document.querySelectorAll('[data-slot="combobox-separator"]')).toHaveLength(0);
  });

  it("should list Ollama once when the catalog already has it", async () => {
    h.providers.mockResolvedValue({
      type: "providers",
      oauth: [],
      all: [{ provider: "ollama", displayName: "ollama", oauth: false, configured: true }],
    });
    render(<ConnectStep onOpen={() => {}} />);
    fireEvent.click(await openList());
    await screen.findByRole("option", { name: "Ollama" });
    expect(optionNames()).toEqual(["Ollama"]);
  });

  it("should offer no key route for a subscription-only provider", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider(/ChatGPT/);
    expect(screen.getByRole("button", { name: "Sign in with ChatGPT" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use an API key instead" })).toBeNull();
  });

  it("should still ask for a provider when the catalog cannot be read", async () => {
    h.providers.mockRejectedValue(new Error("offline"));
    render(<ConnectStep onOpen={() => {}} />);
    // The list is empty, but the step renders and says what it wants.
    expect(await screen.findByRole("combobox")).toHaveTextContent("Select a provider");
  });

  it("should offer the subscription first for a provider that has one", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider(/Claude/);
    expect(screen.getByRole("button", { name: "Sign in with Claude" })).toBeInTheDocument();
    expect(screen.getByText(/Your Claude Pro or Max plan runs the model/)).toBeInTheDocument();
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("should swap to the key field on request, and back", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider(/Claude/);
    fireEvent.click(screen.getByRole("button", { name: "Use an API key instead" }));
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    // The key comes from the company, not the product.
    expect(screen.getByText(/Paste an API key from your Anthropic account/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign in with a subscription instead" }));
    expect(screen.getByRole("button", { name: "Sign in with Claude" })).toBeInTheDocument();
  });

  it("should ask for a key straight away when the provider has no subscription", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Groq");
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign in/ })).toBeNull();
  });

  it("should offer Ollama even before it has models registered", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Ollama");
    expect(await screen.findByText(/Ollama isn't running/)).toBeInTheDocument();
  });

  it("should start over when another provider is chosen", async () => {
    render(<ConnectStep onOpen={() => {}} />);
    await pickProvider("Groq");
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test" } });
    await pickProvider(/Claude/);
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
    expect(await screen.findByText("Llama 3")).toBeInTheDocument();
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
    await pickProvider(/Claude/);
    await waitFor(() => expect(oauthMock.onDone).not.toBeNull());
    oauthMock.onDone?.("anthropic");
    expect(await screen.findByRole("heading", { name: "Connected to Claude" })).toBeInTheDocument();
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
