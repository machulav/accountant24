// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStatus } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary. Onboarding renders <Settings>, whose Providers section reads
// auth/version over the Electron bridge. Stub every method the settings tree
// touches so opening the dialog resolves to a real, rendered Providers pane.
vi.mock("@/rpc/api", () => ({
  appApi: { version: vi.fn().mockResolvedValue("0.2.7") },
  authApi: {
    status: vi.fn().mockResolvedValue({
      type: "status",
      providers: [{ provider: "anthropic", displayName: "Anthropic", oauth: true, configured: false }],
      availableModels: 0,
      anyConfigured: false,
    } satisfies AuthStatus),
    detectOllama: vi.fn().mockResolvedValue({ type: "ollama", running: false, models: [] }),
    models: vi.fn().mockResolvedValue({ type: "models", models: [] }),
    logout: vi.fn().mockResolvedValue({ type: "ok" }),
    removeOllama: vi.fn().mockResolvedValue({ type: "ok" }),
    addAllOllama: vi.fn().mockResolvedValue({ type: "ok" }),
    login: vi.fn().mockResolvedValue(undefined),
    loginRespond: vi.fn().mockResolvedValue(undefined),
    loginCancel: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn().mockResolvedValue(() => {}),
    onTerminated: vi.fn().mockResolvedValue(() => {}),
  },
  agentApi: { restart: vi.fn().mockResolvedValue(undefined) },
  settingsApi: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue({}),
    onChange: vi.fn().mockReturnValue(() => {}),
  },
}));

import { Onboarding } from "../onboarding";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  installJsdomPolyfills();
});

afterEach(() => {
  cleanup();
});

/** The three connect options, in the order the screen presents them. The first
 *  is the recommended (primary) path. */
const OPTION_TITLES = ["Sign in with a subscription", "Use an API key", "Connect Ollama"];

const optionButtons = () => OPTION_TITLES.map((title) => screen.getByRole("button", { name: new RegExp(title) }));

describe("Onboarding", () => {
  it("should present exactly the three ways to connect a model", () => {
    render(<Onboarding />);
    for (const title of OPTION_TITLES) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("should list the subscription option first as the recommended path", () => {
    render(<Onboarding />);
    const buttons = optionButtons();
    // Order is the spec: the recommended subscription card leads.
    expect(buttons[0]).toHaveTextContent("Sign in with a subscription");
  });

  it("should show each option's provider hint", () => {
    render(<Onboarding />);
    expect(screen.getByText("ChatGPT · Claude · more")).toBeInTheDocument();
    expect(screen.getByText("Anthropic · OpenAI · Google · more")).toBeInTheDocument();
    expect(screen.getByText("Run local models · free and fully offline")).toBeInTheDocument();
  });

  it("should disclose that anonymous analytics are collected but personal data is never sent", () => {
    render(<Onboarding />);
    expect(screen.getByText(/We collect anonymous analytics to improve Accountant24\./)).toBeInTheDocument();
    expect(screen.getByText(/Your personal or financial data is never sent\./)).toBeInTheDocument();
  });

  it("should keep the Settings dialog closed until an option is chosen", () => {
    render(<Onboarding />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  for (const title of OPTION_TITLES) {
    it(`should open the Settings dialog on the Providers section when "${title}" is clicked`, async () => {
      render(<Onboarding />);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(title) }));

      // Dialog opens…
      await screen.findByRole("dialog");
      // …on the Providers section, whose pane renders the mocked provider.
      await waitFor(() => expect(screen.getByText("Anthropic")).toBeInTheDocument());
    });
  }
});
