// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const detectOllama = vi.hoisted(() => vi.fn());
vi.mock("@/rpc/api", () => ({ authApi: { detectOllama } }));

import { useOllamaInfo } from "../use-ollama-info";

const running = (models: string[]) => ({ type: "ollama", running: true, models });
const stopped = { type: "ollama", running: false, models: [] };

beforeEach(() => {
  detectOllama.mockResolvedValue(stopped);
});
afterEach(() => cleanup());

describe("useOllamaInfo()", () => {
  it("should report nothing while the first check is in flight", () => {
    detectOllama.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useOllamaInfo());
    expect(result.current.info).toBeNull();
  });

  it("should report the models Ollama is serving", async () => {
    detectOllama.mockResolvedValue(running(["llama3", "qwen3"]));
    const { result } = renderHook(() => useOllamaInfo());
    await waitFor(() => expect(result.current.info).toEqual(running(["llama3", "qwen3"])));
  });

  it("should report not running when Ollama is absent", async () => {
    const { result } = renderHook(() => useOllamaInfo());
    await waitFor(() => expect(result.current.info?.running).toBe(false));
  });

  it("should read a failed check as not running", async () => {
    detectOllama.mockImplementation(() => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => useOllamaInfo());
    await waitFor(() => expect(result.current.info).toEqual(stopped));
  });

  it("should check again on demand, showing the pending state in between", async () => {
    const { result } = renderHook(() => useOllamaInfo());
    await waitFor(() => expect(result.current.info).not.toBeNull());

    let resolve: (v: unknown) => void = () => {};
    detectOllama.mockReturnValue(new Promise((r) => (resolve = r)));
    act(() => result.current.recheck());
    expect(result.current.info).toBeNull();

    await act(async () => resolve(running(["llama3"])));
    await waitFor(() => expect(result.current.info).toEqual(running(["llama3"])));
    expect(detectOllama).toHaveBeenCalledTimes(2);
  });

  it("should ignore a failed check that settles after unmount", async () => {
    let reject: (e: unknown) => void = () => {};
    detectOllama.mockImplementation(() => new Promise((_, r) => (reject = r)));
    const { result, unmount } = renderHook(() => useOllamaInfo());
    unmount();
    await act(async () => reject(new Error("offline")));
    expect(result.current.info).toBeNull();
  });

  it("should ignore a check that resolves after unmount", async () => {
    let resolve: (v: unknown) => void = () => {};
    detectOllama.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result, unmount } = renderHook(() => useOllamaInfo());
    unmount();
    await act(async () => resolve(running(["llama3"])));
    expect(result.current.info).toBeNull();
  });
});
