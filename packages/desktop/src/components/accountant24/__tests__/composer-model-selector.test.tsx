// @vitest-environment jsdom

import type { PiClient, PiModelInfo } from "@assistant-ui/react-pi";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PiClientContext } from "@/runtime/modelsContext";
import { newChatModel } from "@/runtime/newChatModel";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// The composer picker reads the authed model catalog from the PiClient
// (getAvailableModels), the active session selection from the pi runtime
// (usePiRuntimeExtras), and the scoped/default set from app settings. Those are
// the faked I/O boundaries; the picker's own value resolution + wiring run for
// real. The base ModelSelector (Base UI combobox) renders the list.
const h = vi.hoisted(() => ({
  getModels: vi.fn(),
  extras: {
    metadata: undefined as { config?: { provider?: string; modelId?: string } } | undefined,
    setModel: vi.fn(),
  },
  register: vi.fn(() => vi.fn()),
  onModelsChanged: vi.fn(() => () => {}),
  settingsGet: vi.fn(),
  settingsOnChange: vi.fn(() => () => {}),
}));

vi.mock("@assistant-ui/react", () => ({
  useAui: () => ({ modelContext: () => ({ register: h.register }) }),
}));
vi.mock("@assistant-ui/react-pi", () => ({
  usePiRuntimeExtras: () => h.extras,
}));
vi.mock("@/rpc/api", () => ({
  agentApi: { onModelsChanged: h.onModelsChanged },
  settingsApi: { get: h.settingsGet, onChange: h.settingsOnChange },
}));

import { ComposerModelSelector } from "../composer-model-selector";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

const MODELS: PiModelInfo[] = [
  { provider: "anthropic", modelId: "fable", name: "Claude Fable 5", supportsThinking: true },
  { provider: "anthropic", modelId: "haiku", name: "Claude Haiku 4.5", supportsThinking: false },
  { provider: "openai", modelId: "gpt", name: "GPT-5.5", supportsThinking: false },
];

const fakeClient = { getAvailableModels: h.getModels } as unknown as PiClient;

const renderSelector = (client: PiClient | null = fakeClient) =>
  render(
    <PiClientContext.Provider value={client}>
      <ComposerModelSelector />
    </PiClientContext.Provider>,
  );

const openPopup = async () => {
  fireEvent.click(await screen.findByRole("combobox"));
  await screen.findByPlaceholderText("Search models...");
};

const itemNames = () =>
  screen.queryAllByRole("option").map((el) => el.querySelector(".truncate")?.textContent ?? el.textContent);

beforeEach(() => {
  h.getModels.mockResolvedValue(MODELS);
  h.settingsGet.mockResolvedValue({});
  h.extras.metadata = undefined;
  newChatModel.set(undefined);
});

afterEach(() => {
  cleanup();
});

describe("ComposerModelSelector — model list", () => {
  it("should list every model when none are scoped out", async () => {
    renderSelector();
    await openPopup();
    expect(itemNames()).toEqual(["Claude Fable 5", "Claude Haiku 4.5", "GPT-5.5"]);
  });

  it("should narrow the list to the scoped models from settings", async () => {
    h.settingsGet.mockResolvedValue({ enabledModels: ["openai/gpt"] });
    renderSelector();
    await openPopup();
    expect(itemNames()).toEqual(["GPT-5.5"]);
  });

  it("should keep the selected model listable even when it is outside the scoped set", async () => {
    // Default is Fable, but only GPT is scoped in — Fable must still appear.
    h.settingsGet.mockResolvedValue({ enabledModels: ["openai/gpt"], defaultModel: "anthropic/fable" });
    renderSelector();
    await openPopup();
    expect(itemNames()).toEqual(["GPT-5.5", "Claude Fable 5"]);
  });

  it("should label a model by its provider as the row description", async () => {
    renderSelector();
    await openPopup();
    const gpt = screen.getByText("GPT-5.5").closest("[role=option]");
    expect(gpt?.textContent).toContain("openai");
  });
});

describe("ComposerModelSelector — current selection", () => {
  it("should reflect the active session model in the trigger", async () => {
    h.extras.metadata = { config: { provider: "openai", modelId: "gpt" } };
    renderSelector();
    expect((await screen.findByRole("combobox")).textContent).toContain("GPT-5.5");
  });

  it("should fall back to the configured default when there is no active session", async () => {
    h.settingsGet.mockResolvedValue({ defaultModel: "anthropic/haiku" });
    renderSelector();
    expect((await screen.findByRole("combobox")).textContent).toContain("Claude Haiku 4.5");
  });

  it("should reflect the pending new-chat pick over the default", async () => {
    h.settingsGet.mockResolvedValue({ defaultModel: "anthropic/haiku" });
    newChatModel.set({ provider: "openai", modelId: "gpt" });
    renderSelector();
    expect((await screen.findByRole("combobox")).textContent).toContain("GPT-5.5");
  });

  it("should prefer the active session model over a pending pick and default", async () => {
    h.settingsGet.mockResolvedValue({ defaultModel: "anthropic/haiku" });
    newChatModel.set({ provider: "openai", modelId: "gpt" });
    h.extras.metadata = { config: { provider: "anthropic", modelId: "fable" } };
    renderSelector();
    expect((await screen.findByRole("combobox")).textContent).toContain("Claude Fable 5");
  });

  it("should show the placeholder when nothing is selected", async () => {
    renderSelector();
    expect((await screen.findByRole("combobox")).textContent).toContain("Select model");
  });
});

describe("ComposerModelSelector — changing the selection", () => {
  it("should apply the pick to the active session via the runtime", async () => {
    h.extras.metadata = { config: { provider: "anthropic", modelId: "fable" } };
    renderSelector();
    await openPopup();
    fireEvent.click(screen.getByText("GPT-5.5"));
    await waitFor(() => expect(h.extras.setModel).toHaveBeenCalledWith({ provider: "openai", modelId: "gpt" }));
  });

  it("should not touch the pending new-chat store when a session is active", async () => {
    h.extras.metadata = { config: { provider: "anthropic", modelId: "fable" } };
    renderSelector();
    await openPopup();
    fireEvent.click(screen.getByText("GPT-5.5"));
    await waitFor(() => expect(h.extras.setModel).toHaveBeenCalled());
    expect(newChatModel.get()).toBeUndefined();
  });

  it("should stash the pick for createThread when there is no active session", async () => {
    renderSelector();
    await openPopup();
    fireEvent.click(screen.getByText("GPT-5.5"));
    await waitFor(() => expect(newChatModel.get()).toEqual({ provider: "openai", modelId: "gpt" }));
    expect(h.extras.setModel).not.toHaveBeenCalled();
  });

  it("should register the selected model with the ModelContext for run routing", async () => {
    h.settingsGet.mockResolvedValue({ defaultModel: "anthropic/haiku" });
    renderSelector();
    await screen.findByRole("combobox");
    await waitFor(() => expect(h.register).toHaveBeenCalled());
  });
});

describe("ComposerModelSelector — empty and loading states", () => {
  it("should render nothing while the model catalog is still loading", () => {
    h.getModels.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderSelector();
    expect(container).toBeEmptyDOMElement();
  });

  it("should render nothing when the agent exposes no models", async () => {
    h.getModels.mockResolvedValue([]);
    const { container } = renderSelector();
    // Give the resolved fetch a chance to (not) render anything.
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("should render nothing when there is no PiClient in context", () => {
    const { container } = renderSelector(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("should not register any model context when nothing is selected", async () => {
    renderSelector();
    await screen.findByRole("combobox");
    await new Promise((r) => setTimeout(r, 0));
    expect(h.register).not.toHaveBeenCalled();
  });

  it("should render nothing when fetching the model catalog fails", async () => {
    h.getModels.mockRejectedValue(new Error("agent offline"));
    const { container } = renderSelector();
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("should still show the picker when reading settings fails", async () => {
    h.settingsGet.mockRejectedValue(new Error("settings unreadable"));
    renderSelector();
    // Models still load; the picker falls back to showing them all unscoped.
    await openPopup();
    expect(itemNames()).toEqual(["Claude Fable 5", "Claude Haiku 4.5", "GPT-5.5"]);
  });
});
