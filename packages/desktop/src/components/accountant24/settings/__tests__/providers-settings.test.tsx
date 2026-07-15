// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// IPC boundary: the providers list reads auth/settings and drives the agent
// over the Electron bridge.
vi.mock("@/rpc/api", () => ({
  agentApi: { restart: vi.fn() },
  authApi: {
    status: vi.fn(),
    detectOllama: vi.fn(),
    logout: vi.fn(),
    removeOllama: vi.fn(),
    addAllOllama: vi.fn(),
    models: vi.fn(),
    setKey: vi.fn(),
  },
  settingsApi: { get: vi.fn(), set: vi.fn() },
}));

// The interactive OAuth flow is exercised in provider-dialogs.test.tsx; here we
// only need a controllable, idle sign-in so we can assert the row wiring.
const { oauthMock } = vi.hoisted(() => ({
  oauthMock: {
    active: null as string | null,
    log: [] as string[],
    request: null,
    authUrl: null,
    deviceCode: null,
    error: null as string | null,
    errorProvider: null as string | null,
    // Captured from the render so tests can fire the "sign-in finished" callback.
    onDone: null as (() => void) | null,
    start: vi.fn(),
    respond: vi.fn(),
    cancel: vi.fn(),
    dismissError: vi.fn(),
  },
}));
vi.mock("@/components/auth/useOAuthLogin", () => ({
  useOAuthLogin: (onDone: () => void) => {
    oauthMock.onDone = onDone;
    return oauthMock;
  },
}));

import { agentApi, authApi, settingsApi } from "@/rpc/api";
import type { AuthProviderRow, AuthStatus, OllamaInfo } from "@/rpc/types";
import { ProvidersSettings } from "../providers-settings";

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

const row = (o: Partial<AuthProviderRow> = {}): AuthProviderRow => ({
  provider: "x",
  displayName: "X",
  oauth: false,
  configured: false,
  ...o,
});

const status = (providers: AuthProviderRow[]): AuthStatus => ({
  type: "status",
  providers,
  availableModels: 0,
  anyConfigured: providers.some((p) => p.configured),
});

const ollamaInfo = (o: Partial<OllamaInfo> = {}): OllamaInfo => ({
  type: "ollama",
  running: false,
  models: [],
  ...o,
});

beforeEach(() => {
  vi.mocked(authApi.detectOllama).mockResolvedValue(ollamaInfo());
  vi.mocked(authApi.logout).mockResolvedValue({ type: "ok" });
  vi.mocked(authApi.removeOllama).mockResolvedValue({ type: "ok" });
  vi.mocked(authApi.addAllOllama).mockResolvedValue({ type: "ok", count: 1 });
  vi.mocked(authApi.models).mockResolvedValue({ type: "models", models: [] });
  vi.mocked(agentApi.restart).mockResolvedValue(undefined);
  vi.mocked(settingsApi.get).mockResolvedValue({});
  vi.mocked(settingsApi.set).mockResolvedValue({});
  oauthMock.active = null;
  oauthMock.error = null;
  oauthMock.errorProvider = null;
  oauthMock.onDone = null;
});

afterEach(() => {
  cleanup();
});

/** Return the given names ordered by their position in the DOM. */
const domOrder = (...names: string[]) =>
  [...names.map((n) => screen.getByText(n))]
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((el) => el.textContent);

describe("ProvidersSettings", () => {
  it("should show a loading state until the status resolves", () => {
    vi.mocked(authApi.status).mockReturnValue(new Promise<AuthStatus>(() => {}));
    render(<ProvidersSettings />);
    expect(screen.getByText(/Loading providers/)).toBeInTheDocument();
  });

  describe("grouping and sorting", () => {
    it("should list connected providers before available ones, each group sorted by display name", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([
          row({ provider: "zeta", displayName: "Zeta", configured: true, removable: true }),
          row({ provider: "alpha", displayName: "Alpha", configured: true, removable: true }),
          row({ provider: "gamma", displayName: "Gamma", configured: false, oauth: true }),
          row({ provider: "beta", displayName: "Beta", configured: false, oauth: true }),
        ]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("Alpha");

      expect(screen.getByText("Connected")).toBeInTheDocument();
      expect(screen.getByText("Available")).toBeInTheDocument();
      // Connected (Alpha, Zeta) then Available (Beta, Gamma), each alphabetical.
      expect(domOrder("Zeta", "Alpha", "Gamma", "Beta")).toEqual(["Alpha", "Zeta", "Beta", "Gamma"]);
    });

    it("should not render the Connected section when nothing is configured", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "beta", displayName: "Beta", configured: false, oauth: true })]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("Beta");
      expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    });
  });

  describe("per-provider actions", () => {
    it("should offer Sign In and API Key for an unconfigured OAuth provider", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "anthropic", displayName: "Anthropic", configured: false, oauth: true })]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("Anthropic");
      expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "API Key" })).toBeInTheDocument();
    });

    it("should offer only API Key for an unconfigured non-OAuth provider", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "groq", displayName: "Groq", configured: false, oauth: false })]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("Groq");
      expect(screen.getByRole("button", { name: "API Key" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Sign In" })).not.toBeInTheDocument();
    });

    it("should offer Disconnect for a configured removable provider", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "anthropic", displayName: "Anthropic", configured: true, removable: true })]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("Anthropic");
      expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "API Key" })).not.toBeInTheDocument();
    });

    it("should not offer Disconnect for a configured non-removable provider", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "env-openai", displayName: "OpenAI (env)", configured: true, removable: false })]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("OpenAI (env)");
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("should offer Disconnect for a configured Ollama provider even when not removable", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "ollama", displayName: "Ollama", configured: true, removable: false })]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("Ollama");
      expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    });

    it("should show the connection label for a configured provider", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([
          row({
            provider: "anthropic",
            displayName: "Anthropic",
            configured: true,
            removable: true,
            connection: "Subscription",
          }),
        ]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("Anthropic");
      expect(screen.getByText("Subscription")).toBeInTheDocument();
    });

    it("should start an OAuth sign-in for the clicked provider", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "anthropic", displayName: "Anthropic", configured: false, oauth: true })]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("Anthropic");
      fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
      expect(oauthMock.start).toHaveBeenCalledWith("anthropic");
    });

    it("should open the API key dialog for the clicked provider", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "groq", displayName: "Groq", configured: false, oauth: false })]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("Groq");
      fireEvent.click(screen.getByRole("button", { name: "API Key" }));
      expect(await screen.findByText("Connect Groq")).toBeInTheDocument();
    });
  });

  describe("Ollama row", () => {
    it("should offer an Ollama connect row when Ollama runs with a model and isn't connected", async () => {
      vi.mocked(authApi.status).mockResolvedValue(status([]));
      vi.mocked(authApi.detectOllama).mockResolvedValue(ollamaInfo({ running: true, models: ["llama3"] }));
      render(<ProvidersSettings />);
      expect(await screen.findByRole("button", { name: "Connect" })).toBeInTheDocument();
      expect(screen.getByText("Ollama")).toBeInTheDocument();
    });

    it("should not offer the Ollama row when Ollama isn't running", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "anthropic", displayName: "Anthropic", configured: false, oauth: true })]),
      );
      vi.mocked(authApi.detectOllama).mockResolvedValue(ollamaInfo({ running: false, models: ["llama3"] }));
      render(<ProvidersSettings />);
      await screen.findByText("Anthropic");
      expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
    });

    it("should not offer the Ollama row when Ollama runs but has no models", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "anthropic", displayName: "Anthropic", configured: false, oauth: true })]),
      );
      vi.mocked(authApi.detectOllama).mockResolvedValue(ollamaInfo({ running: true, models: [] }));
      render(<ProvidersSettings />);
      await screen.findByText("Anthropic");
      expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
    });

    it("should not offer a separate connect row when Ollama is already connected", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "ollama", displayName: "Ollama", configured: true, removable: false })]),
      );
      vi.mocked(authApi.detectOllama).mockResolvedValue(ollamaInfo({ running: true, models: ["llama3"] }));
      render(<ProvidersSettings />);
      await screen.findByText("Ollama");
      expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    });

    it("should register all local models when Ollama is connected", async () => {
      vi.mocked(authApi.status).mockResolvedValue(status([]));
      vi.mocked(authApi.detectOllama).mockResolvedValue(ollamaInfo({ running: true, models: ["llama3"] }));
      render(<ProvidersSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
      await waitFor(() => expect(authApi.addAllOllama).toHaveBeenCalledTimes(1));
    });
  });

  describe("disconnect flow", () => {
    it("should log out, clear a dangling default model, restart the agent, and reload", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "openai", displayName: "OpenAI", configured: true, removable: true })]),
      );
      vi.mocked(settingsApi.get).mockResolvedValue({ defaultModel: "openai/gpt-4" });
      render(<ProvidersSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

      await waitFor(() => expect(agentApi.restart).toHaveBeenCalledTimes(1));
      expect(authApi.logout).toHaveBeenCalledWith("openai");
      expect(authApi.removeOllama).not.toHaveBeenCalled();
      // The default model belonged to the removed provider, so it's cleared.
      expect(settingsApi.set).toHaveBeenCalledWith({ defaultModel: undefined });
      // reload() re-reads status: once on mount, once after disconnect.
      expect(vi.mocked(authApi.status).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("should keep the default model when it belongs to another provider", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "openai", displayName: "OpenAI", configured: true, removable: true })]),
      );
      vi.mocked(settingsApi.get).mockResolvedValue({ defaultModel: "anthropic/claude" });
      render(<ProvidersSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

      await waitFor(() => expect(agentApi.restart).toHaveBeenCalledTimes(1));
      expect(settingsApi.set).not.toHaveBeenCalled();
    });

    it("should remove Ollama via its own path rather than logout", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "ollama", displayName: "Ollama", configured: true, removable: false })]),
      );
      render(<ProvidersSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

      await waitFor(() => expect(authApi.removeOllama).toHaveBeenCalledTimes(1));
      expect(authApi.logout).not.toHaveBeenCalled();
      expect(agentApi.restart).toHaveBeenCalledTimes(1);
    });
  });

  describe("adding a provider (afterAdd)", () => {
    it("should restart the agent and widen the enabled-model list to the new provider after an API key save", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "groq", displayName: "Groq", configured: false, oauth: false })]),
      );
      // A scoped list that doesn't yet include Groq's model (so adding it must widen).
      vi.mocked(settingsApi.get).mockResolvedValue({ enabledModels: ["openai/gpt-4"] });
      vi.mocked(authApi.models).mockResolvedValue({
        type: "models",
        models: [
          { provider: "openai", id: "gpt-4" },
          { provider: "openai", id: "gpt-5" },
          { provider: "groq", id: "llama" },
        ],
      } as never);
      vi.mocked(authApi.setKey).mockResolvedValue({ type: "ok" });

      render(<ProvidersSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "API Key" }));
      fireEvent.change(await screen.findByLabelText("API Key"), { target: { value: "sk-groq" } });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));

      await waitFor(() => expect(agentApi.restart).toHaveBeenCalledTimes(1));
      expect(authApi.setKey).toHaveBeenCalledWith("groq", "sk-groq");
      // The new provider's model is unioned into the scoped list (spec: adding a
      // provider must not leave its models hidden), ordered by the full model list.
      expect(settingsApi.set).toHaveBeenCalledWith({ enabledModels: ["openai/gpt-4", "groq/llama"] });
    });

    it("should leave the enabled-model list untouched when everything was already enabled", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "groq", displayName: "Groq", configured: false, oauth: false })]),
      );
      // No scoped list means "all enabled": adding a provider needs no widening.
      vi.mocked(settingsApi.get).mockResolvedValue({});
      vi.mocked(authApi.models).mockResolvedValue({
        type: "models",
        models: [{ provider: "groq", id: "llama" }],
      } as never);
      vi.mocked(authApi.setKey).mockResolvedValue({ type: "ok" });

      render(<ProvidersSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "API Key" }));
      fireEvent.change(await screen.findByLabelText("API Key"), { target: { value: "sk-groq" } });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));

      await waitFor(() => expect(agentApi.restart).toHaveBeenCalledTimes(1));
      expect(settingsApi.set).not.toHaveBeenCalled();
    });

    it("should widen the enabled-model list for the signing provider when an OAuth sign-in completes", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "anthropic", displayName: "Anthropic", configured: false, oauth: true })]),
      );
      vi.mocked(settingsApi.get).mockResolvedValue({ enabledModels: ["openai/gpt-4"] });
      vi.mocked(authApi.models).mockResolvedValue({
        type: "models",
        models: [
          { provider: "openai", id: "gpt-4" },
          { provider: "openai", id: "gpt-5" },
          { provider: "anthropic", id: "claude" },
        ],
      } as never);

      render(<ProvidersSettings />);
      // Arm the flow for anthropic, then simulate the hook signalling completion.
      fireEvent.click(await screen.findByRole("button", { name: "Sign In" }));
      expect(oauthMock.start).toHaveBeenCalledWith("anthropic");
      await act(async () => {
        oauthMock.onDone?.();
      });

      await waitFor(() => expect(agentApi.restart).toHaveBeenCalledTimes(1));
      expect(settingsApi.set).toHaveBeenCalledWith({ enabledModels: ["openai/gpt-4", "anthropic/claude"] });
    });

    it("should just reload without an add when a sign-in completes with no provider armed", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "anthropic", displayName: "Anthropic", configured: false, oauth: true })]),
      );
      render(<ProvidersSettings />);
      await screen.findByText("Anthropic");
      const statusCallsBefore = vi.mocked(authApi.status).mock.calls.length;

      // No Sign In was clicked, so signingProvider is null: the done callback only reloads.
      await act(async () => {
        oauthMock.onDone?.();
      });

      await waitFor(() => expect(vi.mocked(authApi.status).mock.calls.length).toBeGreaterThan(statusCallsBefore));
      expect(agentApi.restart).not.toHaveBeenCalled();
    });
  });

  describe("OAuth error surfacing", () => {
    it("should keep the sign-in dialog open for the provider whose flow failed", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "anthropic", displayName: "Anthropic", configured: false, oauth: true })]),
      );
      // active is already null after a failure; the dialog stays open via errorProvider.
      oauthMock.active = null;
      oauthMock.error = "Sign-in failed";
      oauthMock.errorProvider = "anthropic";
      render(<ProvidersSettings />);
      expect(await screen.findByText("Sign in to Anthropic")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Sign-in failed");
    });
  });

  describe("Ollama detection failure", () => {
    it("should not offer the Ollama row when detection rejects", async () => {
      vi.mocked(authApi.status).mockResolvedValue(
        status([row({ provider: "anthropic", displayName: "Anthropic", configured: false, oauth: true })]),
      );
      vi.mocked(authApi.detectOllama).mockRejectedValue(new Error("no ollama"));
      render(<ProvidersSettings />);
      await screen.findByText("Anthropic");
      expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
    });
  });

  describe("Ollama connect errors", () => {
    it("should surface an error result and re-enable Connect when registering models fails", async () => {
      vi.mocked(authApi.status).mockResolvedValue(status([]));
      vi.mocked(authApi.detectOllama).mockResolvedValue(ollamaInfo({ running: true, models: ["llama3"] }));
      vi.mocked(authApi.addAllOllama).mockResolvedValue({ type: "error", message: "daemon down" } as never);

      render(<ProvidersSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "Connect" }));

      expect(await screen.findByText("daemon down", { exact: false })).toBeInTheDocument();
      // The button returns to its idle label so the user can retry.
      expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
      expect(agentApi.restart).not.toHaveBeenCalled();
    });
  });
});
