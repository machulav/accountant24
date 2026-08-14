// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook reaches the main process through @/rpc/api; mock that boundary.
const models = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
const set = vi.hoisted(() => vi.fn());
vi.mock("@/rpc/api", () => ({
  authApi: { models },
  settingsApi: { get, set },
}));

import { useEnsureDefaultModel } from "../use-default-model";

const MODELS = [
  { provider: "alpha", id: "alpha-mini", name: "Alpha Mini" },
  { provider: "alpha", id: "alpha-pro", name: "Alpha Pro" },
  { provider: "beta", id: "beta-max", name: "Beta Max" },
];
const MINI = "alpha/alpha-mini";
const PRO = "alpha/alpha-pro";
const MAX = "beta/beta-max";

const availableModels = (providerDefaults: Record<string, string> = {}) => ({
  type: "models",
  models: MODELS,
  providerDefaults,
});

beforeEach(() => {
  models.mockResolvedValue(availableModels());
  get.mockResolvedValue({});
  set.mockResolvedValue({});
});

afterEach(() => cleanup());

/** Let the hook's async work settle before asserting nothing happened. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("useEnsureDefaultModel()", () => {
  it("should choose a default model when none is set", async () => {
    renderHook(() => useEnsureDefaultModel());
    await waitFor(() => expect(set).toHaveBeenCalledWith({ defaultModel: MINI }));
  });

  it("should choose the model pi recommends for the provider", async () => {
    models.mockResolvedValue(availableModels({ alpha: "alpha-pro" }));
    renderHook(() => useEnsureDefaultModel());
    await waitFor(() => expect(set).toHaveBeenCalledWith({ defaultModel: PRO }));
  });

  it("should keep the default model the user already chose", async () => {
    get.mockResolvedValue({ defaultModel: MAX });
    renderHook(() => useEnsureDefaultModel());
    await settle();
    expect(set).not.toHaveBeenCalled();
  });

  it("should not choose a default model when no models are available", async () => {
    models.mockResolvedValue({ type: "models", models: [], providerDefaults: {} });
    renderHook(() => useEnsureDefaultModel());
    await settle();
    expect(set).not.toHaveBeenCalled();
  });

  it("should enable the chosen model when the user's allow-list excludes it", async () => {
    models.mockResolvedValue(availableModels({ alpha: "alpha-pro" }));
    get.mockResolvedValue({ enabledModels: [MAX] });
    renderHook(() => useEnsureDefaultModel());
    await waitFor(() => expect(set).toHaveBeenCalledWith({ defaultModel: PRO, enabledModels: [PRO, MAX] }));
  });

  it("should leave the allow-list alone when it already holds the chosen model", async () => {
    get.mockResolvedValue({ enabledModels: [MINI, MAX] });
    renderHook(() => useEnsureDefaultModel());
    await waitFor(() => expect(set).toHaveBeenCalledWith({ defaultModel: MINI }));
  });

  it("should not write an allow-list when every model is already enabled", async () => {
    get.mockResolvedValue({ enabledModels: [] });
    renderHook(() => useEnsureDefaultModel());
    await waitFor(() => expect(set).toHaveBeenCalledWith({ defaultModel: MINI }));
  });

  it("should write once per mount", async () => {
    renderHook(() => useEnsureDefaultModel());
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    await settle();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("should stay quiet when the model list cannot be read", async () => {
    models.mockRejectedValue(new Error("offline"));
    renderHook(() => useEnsureDefaultModel());
    await settle();
    expect(set).not.toHaveBeenCalled();
  });

  it("should stay quiet when the settings cannot be read", async () => {
    get.mockRejectedValue(new Error("unreadable"));
    renderHook(() => useEnsureDefaultModel());
    await settle();
    expect(set).not.toHaveBeenCalled();
  });

  it("should not throw when saving the default fails", async () => {
    set.mockRejectedValue(new Error("disk full"));
    renderHook(() => useEnsureDefaultModel());
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
  });
});
