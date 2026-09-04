// @vitest-environment jsdom

// Integration: the first-run flow end to end over the real rpc layer and a
// fake IPC bridge. Real App + wizard + the embedded Providers pane + the API
// key dialog; only the chat layout is stubbed. Asserts both what the user sees
// at each step and the exact IPC traffic (connect, agent restart, the one
// settings write that preselects the default model, the funnel events).

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, AuthModels, AuthStatus, OllamaInfo } from "@/rpc/types";
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
 *  they bring, and app-settings.json. */
let anthropicConnected: boolean;
let ollamaConnected: boolean;
let ollama: OllamaInfo;
let settings: AppSettings;

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
  providers: [
    {
      provider: "anthropic",
      displayName: "Anthropic",
      oauth: false,
      configured: anthropicConnected,
      ...(anthropicConnected ? { connection: "API Key", removable: true } : {}),
    },
    ...(ollamaConnected
      ? [{ provider: "ollama", displayName: "Ollama", oauth: false, configured: true, connection: "Custom" }]
      : []),
  ],
  availableModels: modelsNow().models.length,
  anyConfigured: anthropicConnected || ollamaConnected,
});

beforeEach(() => {
  anthropicConnected = false;
  ollamaConnected = false;
  ollama = { type: "ollama", running: false, models: [] };
  settings = {};
  bridge.setHandler("auth_status", () => statusNow());
  bridge.setHandler("auth_models", () => modelsNow());
  bridge.setHandler("auth_detect_ollama", () => ollama);
  bridge.setHandler("auth_set_key", (payload) => {
    const { provider } = payload as { provider: string; key: string };
    anthropicConnected = true;
    return { type: "done", provider };
  });
  bridge.setHandler("auth_logout", () => {
    anthropicConnected = false;
    return { type: "done", provider: "anthropic" };
  });
  bridge.setHandler("auth_add_all_ollama", () => {
    ollamaConnected = true;
    return { type: "done", provider: "ollama", count: 1 };
  });
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

const startButton = () => screen.getByRole("button", { name: "Start" });
const channels = () => bridge.calls.map((c) => c.channel);
const events = () => bridge.callsFor("analytics_track").map((p) => (p as { event: string }).event);

/** Boot the app on a fresh workspace and go through the welcome page. */
async function reachSetup() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await screen.findByText("Available");
  expect(startButton()).toBeDisabled();
}

/** Paste a key for Anthropic in the embedded provider list. */
async function connectAnthropic() {
  fireEvent.click(screen.getByRole("button", { name: "API Key" }));
  await screen.findByText("Connect Anthropic");
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(startButton()).toBeEnabled());
}

describe("Onboarding flow (API key)", () => {
  it("should boot to the welcome page and only read state until Get started", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Accountant24" })).toBeInTheDocument();
    expect(screen.queryByTestId("chat-layout")).not.toBeInTheDocument();
    // App checks models/settings for the gate and the default-model fill; nothing is written.
    expect(bridge.callsFor("settings_set")).toEqual([]);
    expect(bridge.callsFor("analytics_track")).toEqual([]);
  });

  it("should reach the provider setup with the setup-viewed milestone", async () => {
    await reachSetup();
    expect(screen.getByRole("heading", { name: "Connect a provider" })).toBeInTheDocument();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
    expect(bridge.callsFor("analytics_track")).toEqual([
      { event: "onboarding_setup_viewed", props: undefined, once: true },
    ]);
  });

  it("should connect, restart the agent, and preselect the default model in one write", async () => {
    await reachSetup();
    const before = bridge.calls.length;
    await connectAnthropic();

    const after = channels()
      .slice(before)
      .filter((c) => c !== "auth_status" && c !== "auth_models" && c !== "settings_get");
    // Opening the key dialog first cancels any sign-in in flight (auth_login_cancel).
    expect(after).toEqual(["auth_login_cancel", "auth_set_key", "agent_restart", "settings_set"]);
    expect(bridge.callsFor("auth_set_key")).toEqual([{ provider: "anthropic", key: "sk-test" }]);
    expect(bridge.callsFor("settings_set")).toEqual([{ defaultModel: "anthropic/claude-x" }]);
  });

  it("should show the preselected model, the provider as connected, and stay on the wizard", async () => {
    await reachSetup();
    await connectAnthropic();

    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("Claude X"));
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.queryByTestId("chat-layout")).not.toBeInTheDocument();
  });

  it("should enter the chat on Start with the completed milestone", async () => {
    await reachSetup();
    await connectAnthropic();

    fireEvent.click(startButton());
    expect(await screen.findByTestId("chat-layout")).toBeInTheDocument();
    expect(events()).toEqual(["onboarding_setup_viewed", "onboarding_completed"]);
  });

  it("should stay on the wizard with Start disabled again when the provider is disconnected", async () => {
    await reachSetup();
    await connectAnthropic();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(startButton()).toBeDisabled());
    expect(bridge.callsFor("auth_logout")).toEqual([{ provider: "anthropic" }]);
    // The default came from the removed provider, so it is cleared.
    expect(bridge.callsFor("settings_set").at(-1)).toEqual({ defaultModel: undefined });
    expect(screen.getByRole("heading", { name: "Connect a provider" })).toBeInTheDocument();
    expect(screen.getByText("Connect a provider to choose a default model.")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-layout")).not.toBeInTheDocument();
  });
});

describe("Onboarding flow (Ollama only)", () => {
  beforeEach(() => {
    ollama = { type: "ollama", running: true, models: ["llama3"] };
  });

  it("should connect every local model and default to the first one", async () => {
    await reachSetup();
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    await waitFor(() => expect(startButton()).toBeEnabled());

    expect(bridge.callsFor("auth_add_all_ollama")).toEqual([undefined]);
    expect(bridge.callsFor("settings_set")).toEqual([{ defaultModel: "ollama/llama3" }]);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("llama3"));
  });
});
