// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthEvent } from "@/rpc/types";

// The auth helper's IPC surface is the faked boundary. `login`, `loginRespond`,
// and `loginCancel` are one-shot commands; `onEvent`/`onTerminated` subscribe to
// the server→renderer push streams. We capture the subscribed callbacks so a
// test can drive the auth-event stream on demand, and hand back an unsubscribe
// spy so cleanup is observable.
const login = vi.fn<(provider: string) => Promise<void>>();
const loginRespond = vi.fn<(id: string, value: string | null) => Promise<void>>();
const loginCancel = vi.fn<() => Promise<void>>();
const unsubEvent = vi.fn();
const unsubTerminated = vi.fn();

let emitEvent: ((event: AuthEvent) => void) | undefined;
let emitTerminated: ((code: number | null) => void) | undefined;

vi.mock("@/rpc/api", () => ({
  authApi: {
    login: (provider: string) => login(provider),
    loginRespond: (id: string, value: string | null) => loginRespond(id, value),
    loginCancel: () => loginCancel(),
    onEvent: async (cb: (event: AuthEvent) => void) => {
      emitEvent = cb;
      return unsubEvent;
    },
    onTerminated: async (cb: (code: number | null) => void) => {
      emitTerminated = cb;
      return unsubTerminated;
    },
  },
}));

import { useOAuthLogin } from "../useOAuthLogin";

beforeEach(() => {
  login.mockResolvedValue(undefined);
  loginRespond.mockResolvedValue(undefined);
  loginCancel.mockResolvedValue(undefined);
  emitEvent = undefined;
  emitTerminated = undefined;
});

afterEach(() => {
  cleanup();
});

/** Start a sign-in and wait until the hook has subscribed to the event stream. */
async function startLogin(onDone?: () => void) {
  const hook = renderHook(() => useOAuthLogin(onDone));
  await act(async () => {
    await hook.result.current.start("anthropic");
  });
  return hook;
}

describe("useOAuthLogin()", () => {
  describe("initial state", () => {
    it("should be idle before any sign-in starts", () => {
      const { result } = renderHook(() => useOAuthLogin());
      expect(result.current.active).toBeNull();
      expect(result.current.request).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.log).toEqual([]);
    });
  });

  describe("start()", () => {
    it("should mark the provider active when a sign-in starts", async () => {
      const { result } = await startLogin();
      expect(result.current.active).toBe("anthropic");
    });

    it("should ask the auth helper to log the provider in", async () => {
      await startLogin();
      expect(login).toHaveBeenCalledWith("anthropic");
    });

    it("should subscribe to the auth-event stream", async () => {
      await startLogin();
      expect(emitEvent).toBeDefined();
    });
  });

  describe("progress stream", () => {
    it("should append progress lines to the log in arrival order", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "progress", message: "one" }));
      act(() => emitEvent?.({ type: "progress", message: "two" }));
      expect(result.current.log).toEqual(["one", "two"]);
    });

    it("should expose the browser auth url when it arrives", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "auth", url: "https://auth.example" }));
      expect(result.current.authUrl).toBe("https://auth.example");
    });

    it("should expose a device code without logging it", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "device_code", userCode: "AB-12", verificationUri: "https://v" }));
      expect(result.current.deviceCode).toEqual({ userCode: "AB-12", verificationUri: "https://v" });
      expect(result.current.log).toEqual([]);
    });
  });

  describe("pending requests", () => {
    it("should surface a prompt request when the helper asks a question", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "prompt", id: "q1", message: "Code?" }));
      expect(result.current.request).toEqual({
        id: "q1",
        kind: "prompt",
        message: "Code?",
        placeholder: undefined,
        allowEmpty: undefined,
      });
    });

    it("should surface a select request with its options", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "select", id: "q2", message: "Pick", options: [{ id: "a", label: "A" }] }));
      expect(result.current.request).toEqual({
        id: "q2",
        kind: "select",
        message: "Pick",
        options: [{ id: "a", label: "A" }],
      });
    });
  });

  describe("respond()", () => {
    it("should send the answer for the pending request and clear it", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "prompt", id: "q1", message: "Code?" }));
      act(() => result.current.respond("1234"));
      expect(loginRespond).toHaveBeenCalledWith("q1", "1234");
      expect(result.current.request).toBeNull();
    });

    it("should forward a null answer (decline) for the pending request", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "manual_code", id: "q9" }));
      act(() => result.current.respond(null));
      expect(loginRespond).toHaveBeenCalledWith("q9", null);
    });

    it("should do nothing when there is no pending request", async () => {
      const { result } = await startLogin();
      act(() => result.current.respond("noop"));
      expect(loginRespond).not.toHaveBeenCalled();
    });
  });

  describe("done", () => {
    it("should end the active sign-in when it completes", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "done", provider: "anthropic" }));
      expect(result.current.active).toBeNull();
    });

    it("should invoke the completion callback when the sign-in completes", async () => {
      const onDone = vi.fn();
      await startLogin(onDone);
      act(() => emitEvent?.({ type: "done", provider: "anthropic" }));
      expect(onDone).toHaveBeenCalledOnce();
    });

    it("should unsubscribe from the stream once the sign-in completes", async () => {
      await startLogin();
      act(() => emitEvent?.({ type: "done", provider: "anthropic" }));
      expect(unsubEvent).toHaveBeenCalled();
    });

    it("should not invoke the completion callback while the flow is still running", async () => {
      const onDone = vi.fn();
      await startLogin(onDone);
      act(() => emitEvent?.({ type: "progress", message: "still going" }));
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  describe("error", () => {
    it("should surface the error and remember the failed provider", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "error", message: "denied" }));
      expect(result.current.error).toBe("denied");
      expect(result.current.errorProvider).toBe("anthropic");
      expect(result.current.active).toBeNull();
    });

    it("should not invoke the completion callback when the flow fails", async () => {
      const onDone = vi.fn();
      await startLogin(onDone);
      act(() => emitEvent?.({ type: "error", message: "denied" }));
      expect(onDone).not.toHaveBeenCalled();
    });

    it("should clear the error when dismissed", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "error", message: "denied" }));
      act(() => result.current.dismissError());
      expect(result.current.error).toBeNull();
      expect(result.current.errorProvider).toBeNull();
    });
  });

  describe("terminated stream", () => {
    it("should report an unexpected exit when the helper dies with a non-zero code", async () => {
      const { result } = await startLogin();
      act(() => emitTerminated?.(1));
      expect(result.current.error).toBe("Login process exited unexpectedly.");
      expect(result.current.errorProvider).toBe("anthropic");
    });

    it("should stay quiet when the helper exits cleanly (code 0)", async () => {
      const { result } = await startLogin();
      act(() => emitTerminated?.(0));
      expect(result.current.error).toBeNull();
    });
  });

  describe("cancel()", () => {
    it("should ask the helper to cancel the in-flight sign-in", async () => {
      const { result } = await startLogin();
      act(() => result.current.cancel());
      expect(loginCancel).toHaveBeenCalledOnce();
    });

    it("should drop the active flow and any pending request when cancelled", async () => {
      const { result } = await startLogin();
      act(() => emitEvent?.({ type: "manual_code", id: "q1" }));
      act(() => result.current.cancel());
      expect(result.current.active).toBeNull();
      expect(result.current.request).toBeNull();
    });

    it("should unsubscribe from the stream when cancelled", async () => {
      const { result } = await startLogin();
      act(() => result.current.cancel());
      expect(unsubEvent).toHaveBeenCalled();
    });
  });

  describe("cleanup", () => {
    it("should unsubscribe from the stream on unmount", async () => {
      const { unmount } = await startLogin();
      unmount();
      expect(unsubEvent).toHaveBeenCalled();
      expect(unsubTerminated).toHaveBeenCalled();
    });
  });
});
