// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "@/rpc/types";

// The hook reads models + settings over @/rpc/api and follows the two renderer
// events the provider list fires after a connect; mock that boundary.
const h = vi.hoisted(() => ({
  models: vi.fn(),
  onModelsChanged: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  onChange: vi.fn(),
}));
vi.mock("@/rpc/api", () => ({
  authApi: { models: h.models },
  agentApi: { onModelsChanged: h.onModelsChanged },
  settingsApi: { get: h.get, set: h.set, onChange: h.onChange },
}));

import { useModelChoice } from "../use-model-choice";

const MODELS: ModelInfo[] = [
  { provider: "anthropic", id: "claude-fable", name: "Claude Fable 5" },
  { provider: "openai", id: "gpt-5", name: "GPT-5" },
];
const FABLE = "anthropic/claude-fable";
const GPT = "openai/gpt-5";

let modelsChangedCb: (() => void) | null;
let settingsChangedCb: (() => void) | null;
let unsubscribeModels: ReturnType<typeof vi.fn>;
let unsubscribeSettings: ReturnType<typeof vi.fn>;

beforeEach(() => {
  modelsChangedCb = null;
  settingsChangedCb = null;
  unsubscribeModels = vi.fn();
  unsubscribeSettings = vi.fn();
  h.onModelsChanged.mockImplementation((cb: () => void) => {
    modelsChangedCb = cb;
    return unsubscribeModels;
  });
  h.onChange.mockImplementation((cb: () => void) => {
    settingsChangedCb = cb;
    return unsubscribeSettings;
  });
  h.models.mockResolvedValue({ type: "models", models: [], providerDefaults: {} });
  h.get.mockResolvedValue({});
  h.set.mockResolvedValue({});
});

afterEach(() => cleanup());

describe("useModelChoice()", () => {
  it("should start with no models and no default", () => {
    const { result } = renderHook(() => useModelChoice());
    expect(result.current.models).toEqual([]);
    expect(result.current.defaultModel).toBeUndefined();
    expect(result.current.saveError).toBeNull();
  });

  it("should load the model list and the stored default", async () => {
    h.models.mockResolvedValue({ type: "models", models: MODELS, providerDefaults: {} });
    h.get.mockResolvedValue({ defaultModel: GPT });
    const { result } = renderHook(() => useModelChoice());
    await waitFor(() => expect(result.current.models).toEqual(MODELS));
    await waitFor(() => expect(result.current.defaultModel).toBe(GPT));
  });

  it("should re-read the models when the models-changed event fires", async () => {
    const { result } = renderHook(() => useModelChoice());
    await waitFor(() => expect(h.models).toHaveBeenCalledTimes(1));

    h.models.mockResolvedValue({ type: "models", models: MODELS, providerDefaults: {} });
    await act(async () => {
      modelsChangedCb?.();
    });
    await waitFor(() => expect(result.current.models).toEqual(MODELS));
  });

  it("should re-read the settings when the settings-changed event fires", async () => {
    const { result } = renderHook(() => useModelChoice());
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1));

    h.get.mockResolvedValue({ defaultModel: FABLE });
    await act(async () => {
      settingsChangedCb?.();
    });
    await waitFor(() => expect(result.current.defaultModel).toBe(FABLE));
  });

  it("should write only the default when every model is enabled", async () => {
    h.models.mockResolvedValue({ type: "models", models: MODELS, providerDefaults: {} });
    const { result } = renderHook(() => useModelChoice());
    await waitFor(() => expect(result.current.models).toEqual(MODELS));

    act(() => result.current.setDefault(FABLE));
    expect(h.set).toHaveBeenCalledExactlyOnceWith({ defaultModel: FABLE });
    expect(result.current.defaultModel).toBe(FABLE);
  });

  it("should widen the allow-list when it would hide the new default", async () => {
    h.models.mockResolvedValue({ type: "models", models: MODELS, providerDefaults: {} });
    h.get.mockResolvedValue({ defaultModel: GPT, enabledModels: [GPT] });
    const { result } = renderHook(() => useModelChoice());
    await waitFor(() => expect(result.current.models).toEqual(MODELS));
    await waitFor(() => expect(result.current.defaultModel).toBe(GPT));

    act(() => result.current.setDefault(FABLE));
    // Both models are now enabled, which the store spells as [] (all enabled).
    expect(h.set).toHaveBeenCalledExactlyOnceWith({ defaultModel: FABLE, enabledModels: [] });
  });

  it("should report a save failure and keep the optimistic pick", async () => {
    h.models.mockResolvedValue({ type: "models", models: MODELS, providerDefaults: {} });
    h.set.mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() => useModelChoice());
    await waitFor(() => expect(result.current.models).toEqual(MODELS));

    act(() => result.current.setDefault(FABLE));
    await waitFor(() => expect(result.current.saveError).toBe("Couldn’t save settings: disk full"));
    expect(result.current.defaultModel).toBe(FABLE);
  });

  it("should stringify a non-Error save failure", async () => {
    h.set.mockRejectedValue("boom");
    const { result } = renderHook(() => useModelChoice());
    act(() => result.current.setDefault(FABLE));
    await waitFor(() => expect(result.current.saveError).toBe("Couldn’t save settings: boom"));
  });

  it("should clear the previous save error on the next pick", async () => {
    h.set.mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderHook(() => useModelChoice());
    act(() => result.current.setDefault(FABLE));
    await waitFor(() => expect(result.current.saveError).not.toBeNull());

    act(() => result.current.setDefault(GPT));
    expect(result.current.saveError).toBeNull();
  });

  it("should stay quiet when a load fails", async () => {
    h.models.mockRejectedValue(new Error("offline"));
    h.get.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useModelChoice());
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1));
    expect(result.current.models).toEqual([]);
    expect(result.current.defaultModel).toBeUndefined();
  });

  it("should unsubscribe from both events on unmount", () => {
    const { unmount } = renderHook(() => useModelChoice());
    unmount();
    expect(unsubscribeModels).toHaveBeenCalledTimes(1);
    expect(unsubscribeSettings).toHaveBeenCalledTimes(1);
  });

  it("should ignore a load that resolves after unmount", async () => {
    let resolveModels: (v: unknown) => void = () => {};
    h.models.mockReturnValue(new Promise((r) => (resolveModels = r)));
    const { result, unmount } = renderHook(() => useModelChoice());
    unmount();
    await act(async () => {
      resolveModels({ type: "models", models: MODELS, providerDefaults: {} });
    });
    expect(result.current.models).toEqual([]);
  });
});
