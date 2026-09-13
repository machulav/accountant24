// @vitest-environment jsdom

// Integration: the first-run flow end to end over the real rpc layer and a fake
// IPC bridge. Real App + wizard + the connect panels; only the chat layout is
// stubbed. Asserts what the user sees at each step and the exact IPC traffic
// (the connect, the agent restart, the one settings write that preselects the
// model, the funnel events).

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, AuthModels, AuthProviders, AuthStatus, OllamaInfo } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// rpc/api.ts captures `window.api` at module load — install the fake bridge
// before any import pulls it in (async vi.hoisted runs before the imports).
const bridge = await vi.hoisted(async () => (await import("@/test/fakeApi")).installFakeApi());

vi.mock("@/components/accountant24/chat-layout", () => ({
  ChatLayout: () => <div data-testid="chat-layout">chat</div>,
}));

import App from "../App";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

/** The workspace behind the bridge: which providers are connected, the models
 *  they bring, what Ollama is doing, and app-settings.json. */
let anthropicConnected: boolean;
let ollamaConnected: boolean;
let ollama: OllamaInfo;
let settings: AppSettings;

const CATALOG: AuthProviders = {
  type: "providers",
  oauth: [{ id: "anthropic", name: "Anthropic (Claude Pro/Max)" }],
  all: [{ provider: "anthropic", displayName: "Anthropic", oauth: true, configured: false }],
};

const modelsNow = (): AuthModels => ({
  type: "models",
  models: [
    ...(anthropicConnected ? [{ provider: "anthropic", id: "claude-x", name: "Claude X" }] : []),
    ...(ollamaConnected ? [{ provider: "ollama", id: "llama3", name: "llama3" }] : []),
  ],
  providerDefaults: { anthropic: "claude-x" },
});

const statusNow = (): AuthStatus => ({
  type: "status",
  providers: CATALOG.all,
  availableModels: modelsNow().models.length,
  anyConfigured: anthropicConnected || ollamaConnected,
});

beforeEach(() => {
  anthropicConnected = false;
  ollamaConnected = false;
  ollama = { type: "ollama", running: false, models: [] };
  settings = {};
  bridge.setHandler("auth_status", () => statusNow());
  bridge.setHandler("auth_providers", () => CATALOG);
  bridge.setHandler("auth_models", () => modelsNow());
  bridge.setHandler("auth_detect_ollama", () => ollama);
  bridge.setHandler("auth_set_key", (payload) => {
    anthropicConnected = true;
    return { type: "done", provider: (payload as { provider: string }).provider };
  });
  bridge.setHandler("auth_add_all_ollama", () => {
    ollamaConnected = true;
    return { type: "done", provider: "ollama", count: 1 };
  });
  bridge.setHandler("auth_login", () => undefined);
  bridge.setHandler("auth_login_respond", () => undefined);
  bridge.setHandler("auth_login_cancel", () => undefined);
  bridge.setHandler("agent_restart", () => undefined);
  bridge.setHandler("settings_get", () => settings);
  bridge.setHandler("settings_set", (patch) => {
    settings = { ...settings, ...(patch as Partial<AppSettings>) };
    return settings;
  });
  bridge.setHandler("analytics_track", () => undefined);
});

afterEach(() => {
  cleanup();
  bridge.reset();
});

const events = () => bridge.callsFor("analytics_track").map((p) => (p as { event: string }).event);
/** The channels a step used, minus the reads that can happen at any time. */
const writesSince = (from: number) =>
  bridge.calls
    .slice(from)
    .map((c) => c.channel)
    .filter((c) => !["auth_status", "auth_models", "auth_providers", "settings_get", "auth_detect_ollama"].includes(c));

/** Boot the app on a fresh workspace and step through to the provider choice. */
async function reachConnect() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await screen.findByRole("combobox");
}

const pickProvider = async (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name }));
};

describe("Onboarding, first run", () => {
  it("should open on the welcome step and write nothing", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Welcome to Accountant24" })).toBeInTheDocument();
    expect(screen.queryByTestId("chat-layout")).not.toBeInTheDocument();
    expect(bridge.callsFor("settings_set")).toEqual([]);
    expect(bridge.callsFor("analytics_track")).toEqual([]);
  });

  it("should record reaching the connect step", async () => {
    await reachConnect();
    expect(events()).toEqual(["onboarding_setup_viewed"]);
  });
});

describe("Onboarding, connecting with an API key", () => {
  it("should store the key, restart the agent, and preselect a model in one write", async () => {
    await reachConnect();
    await pickProvider("Anthropic");
    fireEvent.click(screen.getByRole("button", { name: "Use an API key instead" }));
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test" } });

    const before = bridge.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByRole("heading", { name: "Connected to Anthropic" });

    expect(writesSince(before)).toEqual(["auth_set_key", "agent_restart", "settings_set"]);
    expect(bridge.callsFor("auth_set_key")).toEqual([{ provider: "anthropic", key: "sk-test" }]);
    expect(bridge.callsFor("settings_set")).toEqual([{ defaultModel: "anthropic/claude-x" }]);
  });

  it("should enter the chat from the confirmation", async () => {
    await reachConnect();
    await pickProvider("Anthropic");
    fireEvent.click(screen.getByRole("button", { name: "Use an API key instead" }));
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    const open = await screen.findByRole("button", { name: "Open Accountant24" });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    expect(await screen.findByTestId("chat-layout")).toBeInTheDocument();
    expect(events()).toEqual(["onboarding_setup_viewed", "onboarding_completed"]);
  });
});

describe("Onboarding, signing in to a subscription", () => {
  it("should follow the sign-in through to a connected provider", async () => {
    await reachConnect();
    await pickProvider("Anthropic");
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Anthropic" }));
    await waitFor(() => expect(bridge.callsFor("auth_login")).toEqual([{ provider: "anthropic" }]));

    // The browser handoff, then a device code the user types elsewhere.
    await act(async () => {
      bridge.emit("auth-event", { type: "auth", url: "https://example.test/auth" });
    });
    expect(screen.getByRole("link", { name: "Open the sign-in page" })).toBeInTheDocument();
    await act(async () => {
      bridge.emit("auth-event", {
        type: "device_code",
        userCode: "ABCD-1234",
        verificationUri: "https://example.test/dc",
      });
    });
    expect(screen.getByText("ABCD-1234")).toBeInTheDocument();

    anthropicConnected = true;
    await act(async () => {
      bridge.emit("auth-event", { type: "done", provider: "anthropic" });
    });

    expect(await screen.findByRole("heading", { name: "Connected to Anthropic" })).toBeInTheDocument();
    expect(bridge.callsFor("settings_set")).toEqual([{ defaultModel: "anthropic/claude-x" }]);
  });

  it("should answer a question the sign-in asks", async () => {
    await reachConnect();
    await pickProvider("Anthropic");
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Anthropic" }));
    await act(async () => {
      bridge.emit("auth-event", { type: "prompt", id: "q1", message: "Paste the code" });
    });

    fireEvent.change(screen.getByLabelText("Paste the code"), { target: { value: "xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(bridge.callsFor("auth_login_respond")).toEqual([{ id: "q1", value: "xyz" }]));
  });

  it("should abort a running sign-in when another provider is chosen", async () => {
    await reachConnect();
    await pickProvider("Anthropic");
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Anthropic" }));
    await waitFor(() => expect(bridge.callsFor("auth_login")).toHaveLength(1));

    await act(async () => {
      bridge.emit("auth-event", { type: "auth", url: "https://example.test/auth" });
    });
    await pickProvider(/Ollama/);
    await waitFor(() => expect(bridge.callsFor("auth_login_cancel")).toHaveLength(1));
  });
});

describe("Onboarding, running models locally", () => {
  it("should say what to do when Ollama is not running", async () => {
    await reachConnect();
    await pickProvider(/Ollama/);
    expect(await screen.findByText(/Ollama isn't running/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Install Ollama" })).toBeInTheDocument();
  });

  it("should register the local models and preselect one", async () => {
    ollama = { type: "ollama", running: true, models: ["llama3"] };
    await reachConnect();
    await pickProvider(/Ollama/);

    fireEvent.click(await screen.findByRole("button", { name: "Connect Ollama" }));
    expect(await screen.findByRole("heading", { name: "Connected to Ollama" })).toBeInTheDocument();
    expect(bridge.callsFor("auth_add_all_ollama")).toEqual([undefined]);
    expect(bridge.callsFor("settings_set")).toEqual([{ defaultModel: "ollama/llama3" }]);
  });
});
