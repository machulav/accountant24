// @vitest-environment jsdom

// Integration: the top-level gate. App wires useAppScreen() -> useHasModels()
// -> authApi.status() and swaps Onboarding <-> ChatLayout. Real App + real
// hooks over a mocked @/rpc/api boundary; both screens are stubbed (the wizard
// and the chat layout have their own suites), so the gate is what's under test.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

const status = vi.hoisted(() => vi.fn());
const onModelsChanged = vi.hoisted(() => vi.fn());
const models = vi.hoisted(() => vi.fn());
const settingsGet = vi.hoisted(() => vi.fn());
const settingsSet = vi.hoisted(() => vi.fn());
vi.mock("@/rpc/api", () => ({
  authApi: { status, models },
  agentApi: { onModelsChanged },
  settingsApi: { get: settingsGet, set: settingsSet },
}));

vi.mock("@/components/accountant24/chat-layout", () => ({
  ChatLayout: () => <div data-testid="chat-layout">chat</div>,
}));
vi.mock("@/components/accountant24/onboarding/onboarding", () => ({
  Onboarding: ({ onDone }: { onDone: () => void }) => (
    <button type="button" data-testid="onboarding" onClick={onDone}>
      onboarding
    </button>
  ),
}));

import App from "../App";

let modelsChangedCb: (() => void) | null;

beforeAll(() => installJsdomPolyfills());

const MODELS = [
  { provider: "alpha", id: "alpha-mini", name: "Alpha Mini" },
  { provider: "alpha", id: "alpha-pro", name: "Alpha Pro" },
];

beforeEach(() => {
  modelsChangedCb = null;
  onModelsChanged.mockImplementation((cb: () => void) => {
    modelsChangedCb = cb;
    return () => {};
  });
  models.mockResolvedValue({ type: "models", models: MODELS, providerDefaults: { alpha: "alpha-pro" } });
  settingsGet.mockResolvedValue({});
  settingsSet.mockResolvedValue({});
});

afterEach(() => cleanup());

const statusWith = (availableModels: number) => ({
  type: "status",
  providers: [],
  availableModels,
  anyConfigured: availableModels > 0,
});

const onboarding = () => screen.getByTestId("onboarding");
const chat = () => screen.getByTestId("chat-layout");

describe("App gate", () => {
  it("should render neither screen while the first model check is pending", () => {
    status.mockReturnValue(new Promise(() => {}));
    const { container } = render(<App />);
    expect(container).toBeEmptyDOMElement();
  });

  it("should show onboarding when no model is available", async () => {
    status.mockResolvedValue(statusWith(0));
    render(<App />);
    await waitFor(() => expect(onboarding()).toBeInTheDocument());
    expect(screen.queryByTestId("chat-layout")).not.toBeInTheDocument();
  });

  it("should show the chat layout when a model is available", async () => {
    status.mockResolvedValue(statusWith(1));
    render(<App />);
    await waitFor(() => expect(chat()).toBeInTheDocument());
    expect(screen.queryByTestId("onboarding")).not.toBeInTheDocument();
  });

  it("should keep onboarding open when a model appears mid-setup", async () => {
    status.mockResolvedValue(statusWith(0));
    render(<App />);
    await waitFor(() => expect(onboarding()).toBeInTheDocument());

    status.mockResolvedValue(statusWith(1));
    modelsChangedCb?.();
    // The re-check resolves and changes nothing: the wizard decides when it ends.
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
    expect(onboarding()).toBeInTheDocument();
    expect(screen.queryByTestId("chat-layout")).not.toBeInTheDocument();
  });

  it("should enter the chat when onboarding finishes", async () => {
    status.mockResolvedValue(statusWith(0));
    render(<App />);
    await waitFor(() => expect(onboarding()).toBeInTheDocument());

    fireEvent.click(onboarding());
    await waitFor(() => expect(chat()).toBeInTheDocument());
    expect(screen.queryByTestId("onboarding")).not.toBeInTheDocument();
  });

  it("should return to onboarding when every model is removed in the chat", async () => {
    status.mockResolvedValue(statusWith(1));
    render(<App />);
    await waitFor(() => expect(chat()).toBeInTheDocument());

    status.mockResolvedValue(statusWith(0));
    modelsChangedCb?.();
    await waitFor(() => expect(onboarding()).toBeInTheDocument());
    expect(screen.queryByTestId("chat-layout")).not.toBeInTheDocument();
  });
});

describe("App default model", () => {
  it("should choose a default model at start-up when none is set", async () => {
    status.mockResolvedValue(statusWith(2));
    render(<App />);
    // pi recommends alpha-pro, so it wins over the first-listed alpha-mini.
    await waitFor(() => expect(settingsSet).toHaveBeenCalledWith({ defaultModel: "alpha/alpha-pro" }));
  });

  it("should keep the default model the user already chose", async () => {
    status.mockResolvedValue(statusWith(2));
    settingsGet.mockResolvedValue({ defaultModel: "alpha/alpha-mini" });
    render(<App />);
    await waitFor(() => expect(chat()).toBeInTheDocument());
    expect(settingsSet).not.toHaveBeenCalled();
  });

  it("should not choose a default model on a fresh install with no models", async () => {
    status.mockResolvedValue(statusWith(0));
    models.mockResolvedValue({ type: "models", models: [], providerDefaults: {} });
    render(<App />);
    await waitFor(() => expect(onboarding()).toBeInTheDocument());
    expect(settingsSet).not.toHaveBeenCalled();
  });
});
