// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IPC boundary plus the sign-in helper, whose completion callback is captured
// so a finished OAuth flow can be fired synthetically.
const h = vi.hoisted(() => ({
  restart: vi.fn(),
  models: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@/rpc/api", () => ({
  agentApi: { restart: h.restart },
  authApi: { models: h.models },
  settingsApi: { get: h.get, set: h.set },
}));
const oauthMock = vi.hoisted(() => ({ onDone: null as ((provider: string) => void) | null, start: vi.fn() }));
vi.mock("@/hooks/use-oauth-login", () => ({
  useOAuthLogin: (onDone: (provider: string) => void) => {
    oauthMock.onDone = onDone;
    return oauthMock;
  },
}));

import { useProviderConnect } from "../use-provider-connect";

const MODELS = [
  { provider: "openai", id: "gpt-5" },
  { provider: "openai", id: "gpt-4" },
  { provider: "anthropic", id: "claude" },
];

beforeEach(() => {
  oauthMock.onDone = null;
  h.restart.mockResolvedValue(undefined);
  h.models.mockResolvedValue({ type: "models", models: MODELS, providerDefaults: {} });
  h.get.mockResolvedValue({});
  h.set.mockResolvedValue({});
});

afterEach(() => cleanup());

describe("useProviderConnect()", () => {
  it("should restart the agent before writing settings, then report the provider", async () => {
    const order: string[] = [];
    h.restart.mockImplementation(async () => void order.push("restart"));
    h.set.mockImplementation(async () => void order.push("set"));
    const onConnected = vi.fn(() => void order.push("connected"));
    const { result } = renderHook(() => useProviderConnect(onConnected));

    await act(async () => await result.current.finish("anthropic"));
    expect(order).toEqual(["restart", "set", "connected"]);
    expect(onConnected).toHaveBeenCalledExactlyOnceWith("anthropic");
  });

  it("should choose a default model from the provider just connected", async () => {
    const { result } = renderHook(() => useProviderConnect(vi.fn()));
    await act(async () => await result.current.finish("anthropic"));
    expect(h.set).toHaveBeenCalledExactlyOnceWith({ defaultModel: "anthropic/claude" });
  });

  it("should widen an existing allow-list and set the default in one write", async () => {
    h.get.mockResolvedValue({ enabledModels: ["openai/gpt-5"] });
    const { result } = renderHook(() => useProviderConnect(vi.fn()));
    await act(async () => await result.current.finish("anthropic"));
    expect(h.set).toHaveBeenCalledExactlyOnceWith({
      enabledModels: ["openai/gpt-5", "anthropic/claude"],
      defaultModel: "anthropic/claude",
    });
  });

  it("should collapse the allow-list to all-enabled when the new provider completes it", async () => {
    h.get.mockResolvedValue({ enabledModels: ["openai/gpt-5", "openai/gpt-4"] });
    const { result } = renderHook(() => useProviderConnect(vi.fn()));
    await act(async () => await result.current.finish("anthropic"));
    // [] is how the store spells "every model is enabled".
    expect(h.set).toHaveBeenCalledExactlyOnceWith({ enabledModels: [], defaultModel: "anthropic/claude" });
  });

  it("should keep the default the user already chose", async () => {
    h.get.mockResolvedValue({ defaultModel: "openai/gpt-5" });
    const { result } = renderHook(() => useProviderConnect(vi.fn()));
    await act(async () => await result.current.finish("anthropic"));
    expect(h.set).not.toHaveBeenCalled();
  });

  it("should not write when there is nothing to change", async () => {
    h.get.mockResolvedValue({ defaultModel: "openai/gpt-5", enabledModels: [] });
    const { result } = renderHook(() => useProviderConnect(vi.fn()));
    await act(async () => await result.current.finish("anthropic"));
    expect(h.set).not.toHaveBeenCalled();
  });

  it("should leave the default alone when the new provider brought no models", async () => {
    h.models.mockResolvedValue({ type: "models", models: [], providerDefaults: {} });
    const onConnected = vi.fn();
    const { result } = renderHook(() => useProviderConnect(onConnected));
    await act(async () => await result.current.finish("anthropic"));
    expect(h.set).not.toHaveBeenCalled();
    expect(onConnected).toHaveBeenCalledExactlyOnceWith("anthropic");
  });

  it("should still report the provider when adopting its models fails", async () => {
    h.models.mockRejectedValue(new Error("offline"));
    const onConnected = vi.fn();
    const { result } = renderHook(() => useProviderConnect(onConnected));
    await act(async () => await result.current.finish("anthropic"));
    expect(onConnected).toHaveBeenCalledExactlyOnceWith("anthropic");
  });

  it("should run the same steps when a sign-in completes", async () => {
    const onConnected = vi.fn();
    renderHook(() => useProviderConnect(onConnected));
    await act(async () => {
      oauthMock.onDone?.("anthropic");
    });
    await waitFor(() => expect(onConnected).toHaveBeenCalledExactlyOnceWith("anthropic"));
    expect(h.restart).toHaveBeenCalledTimes(1);
  });

  it("should call the latest callback after a re-render", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useProviderConnect(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    await act(async () => await result.current.finish("anthropic"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith("anthropic");
  });
});
