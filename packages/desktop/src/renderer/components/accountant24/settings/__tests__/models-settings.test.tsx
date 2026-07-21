// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, ModelInfo } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: the page reads the authed model list + app settings and writes
// picks/toggles back through settingsApi.set.
const h = vi.hoisted(() => ({
  models: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@/rpc/api", () => ({
  authApi: { models: h.models },
  settingsApi: { get: h.get, set: h.set },
}));

import { ModelsSettings } from "../models-settings";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

const MODELS: ModelInfo[] = [
  { provider: "anthropic", id: "claude-fable", name: "Claude Fable 5" },
  { provider: "anthropic", id: "claude-haiku", name: "Claude Haiku 4.5" },
  { provider: "openai", id: "gpt-5", name: "GPT-5" },
];
// provider/modelId ids, for reference in expectations.
const FABLE = "anthropic/claude-fable";
const HAIKU = "anthropic/claude-haiku";
const GPT = "openai/gpt-5";

beforeEach(() => {
  h.models.mockResolvedValue({ type: "models", models: MODELS });
  h.get.mockResolvedValue({});
  h.set.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
});

const renderWith = (settings: AppSettings) => {
  h.get.mockResolvedValue(settings);
  render(<ModelsSettings />);
};

const openDefaultPicker = async () => {
  fireEvent.click(await screen.findByRole("combobox"));
  await screen.findByPlaceholderText("Search models...");
};

describe("ModelsSettings — empty state", () => {
  it("should prompt to connect a provider for the default model when there are no models", async () => {
    h.models.mockResolvedValue({ type: "models", models: [] });
    render(<ModelsSettings />);
    expect(await screen.findByText("Connect a provider to choose a default model.")).toBeInTheDocument();
  });

  it("should prompt to connect a provider for the toggle list when there are no models", async () => {
    h.models.mockResolvedValue({ type: "models", models: [] });
    render(<ModelsSettings />);
    expect(await screen.findByText("Connect a provider to choose which models appear.")).toBeInTheDocument();
  });
});

describe("ModelsSettings — default model", () => {
  it("should persist the pick as defaultModel when a model is chosen", async () => {
    renderWith({});
    await openDefaultPicker();
    fireEvent.click(screen.getByRole("option", { name: /GPT-5/ }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith({ defaultModel: GPT }));
  });

  it("should also add the new default to a non-empty allow-list", async () => {
    // GPT is the only enabled model; picking Fable as default must enable it too.
    renderWith({ enabledModels: [GPT] });
    await openDefaultPicker();
    fireEvent.click(screen.getByRole("option", { name: /Claude Fable 5/ }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith({ defaultModel: FABLE, enabledModels: [FABLE, GPT] }));
  });

  it("should not touch the allow-list when the new default is already enabled", async () => {
    renderWith({ enabledModels: [FABLE, GPT] });
    await openDefaultPicker();
    fireEvent.click(screen.getByRole("option", { name: /Claude Fable 5/ }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith({ defaultModel: FABLE }));
  });
});

describe("ModelsSettings — enable/disable toggles", () => {
  it("should write the explicit allow-list when a model is turned off", async () => {
    // All enabled (empty list). Turning GPT off leaves the two Claudes.
    renderWith({});
    fireEvent.click(await screen.findByRole("switch", { name: "GPT-5" }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith({ enabledModels: [FABLE, HAIKU] }));
  });

  it("should collapse to the canonical empty list when the last-off model is turned on", async () => {
    // Two of three enabled; enabling the third means all-on → [].
    renderWith({ enabledModels: [FABLE, HAIKU] });
    fireEvent.click(await screen.findByRole("switch", { name: "GPT-5" }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith({ enabledModels: [] }));
  });

  it("should never turn off the last enabled model", async () => {
    // GPT is the only enabled model; turning it off would hide everything.
    renderWith({ enabledModels: [GPT] });
    fireEvent.click(await screen.findByRole("switch", { name: "GPT-5" }));
    // Give the handler a chance to (wrongly) fire before asserting it didn't.
    await new Promise((r) => setTimeout(r, 0));
    expect(h.set).not.toHaveBeenCalled();
  });

  it("should lock the default model on and not persist a change for it", async () => {
    renderWith({ defaultModel: GPT });
    const gptSwitch = await screen.findByRole("switch", { name: "GPT-5" });
    expect(gptSwitch).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Default")).toBeInTheDocument();
    fireEvent.click(gptSwitch);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.set).not.toHaveBeenCalled();
  });
});

describe("ModelsSettings — save errors", () => {
  it("should surface a banner when saving fails", async () => {
    h.set.mockRejectedValue(new Error("disk full"));
    renderWith({});
    fireEvent.click(await screen.findByRole("switch", { name: "GPT-5" }));
    expect(await screen.findByText(/disk full/)).toBeInTheDocument();
  });
});
