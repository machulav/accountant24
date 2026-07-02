import { describe, expect, it } from "vitest";
import { initialOAuthLoginState, type OAuthLoginState, reduceOAuthLogin } from "../oauthLoginState";

const start = (provider = "anthropic"): OAuthLoginState =>
  reduceOAuthLogin(initialOAuthLoginState, { type: "start", provider });

describe("reduceOAuthLogin", () => {
  describe("start", () => {
    it("should activate the provider with a clean slate when a sign-in starts", () => {
      expect(start("github")).toEqual({
        active: "github",
        log: [],
        request: null,
        error: null,
        errorProvider: null,
      });
    });

    it("should clear a previous attempt's error and log when a new sign-in starts", () => {
      let state = start("a");
      state = reduceOAuthLogin(state, { type: "event", event: { type: "progress", message: "step" } });
      state = reduceOAuthLogin(state, { type: "event", event: { type: "error", message: "denied" } });

      expect(reduceOAuthLogin(state, { type: "start", provider: "b" })).toEqual({
        active: "b",
        log: [],
        request: null,
        error: null,
        errorProvider: null,
      });
    });
  });

  describe("progress events", () => {
    it("should append a browser hint when the auth url arrives", () => {
      const state = reduceOAuthLogin(start(), {
        type: "event",
        event: { type: "auth", url: "https://x" },
      });
      expect(state.log).toEqual(["Opened your browser to authorize. Complete sign-in there…"]);
    });

    it("should append the device code instructions when a device_code arrives", () => {
      const state = reduceOAuthLogin(start(), {
        type: "event",
        event: { type: "device_code", userCode: "AB-12", verificationUri: "https://v" },
      });
      expect(state.log).toEqual(["Enter code AB-12 at https://v"]);
    });

    it("should append progress messages in order", () => {
      let state = start();
      state = reduceOAuthLogin(state, { type: "event", event: { type: "progress", message: "one" } });
      state = reduceOAuthLogin(state, { type: "event", event: { type: "progress", message: "two" } });
      expect(state.log).toEqual(["one", "two"]);
    });
  });

  describe("pending requests", () => {
    it("should expose a prompt request when a prompt event arrives", () => {
      const state = reduceOAuthLogin(start(), {
        type: "event",
        event: { type: "prompt", id: "q1", message: "Code?", placeholder: "code" },
      });
      expect(state.request).toEqual({ id: "q1", kind: "prompt", message: "Code?", placeholder: "code" });
    });

    it("should expose a select request with its options when a select event arrives", () => {
      const state = reduceOAuthLogin(start(), {
        type: "event",
        event: { type: "select", id: "q2", message: "Pick", options: [{ id: "a", label: "A" }] },
      });
      expect(state.request).toEqual({ id: "q2", kind: "select", message: "Pick", options: [{ id: "a", label: "A" }] });
    });

    it("should expose a manual_code request with the paste instruction", () => {
      const state = reduceOAuthLogin(start(), { type: "event", event: { type: "manual_code", id: "q3" } });
      expect(state.request).toEqual({ id: "q3", kind: "manual_code", message: "Paste the code from your browser" });
    });

    it("should clear the request when the user responds", () => {
      let state = reduceOAuthLogin(start(), { type: "event", event: { type: "manual_code", id: "q1" } });
      state = reduceOAuthLogin(state, { type: "respond" });
      expect(state.request).toBeNull();
    });
  });

  describe("done", () => {
    it("should deactivate without an error when the sign-in completes", () => {
      const state = reduceOAuthLogin(start("github"), { type: "event", event: { type: "done", provider: "github" } });
      expect(state.active).toBeNull();
      expect(state.error).toBeNull();
      expect(state.errorProvider).toBeNull();
    });
  });

  describe("error", () => {
    it("should keep the error and remember the failed provider when the flow fails", () => {
      const state = reduceOAuthLogin(start("anthropic"), {
        type: "event",
        event: { type: "error", message: "denied" },
      });
      // `active` ends (the panel unmounts) but the error and its provider must
      // survive, so a per-provider view can still show the failure.
      expect(state).toMatchObject({ active: null, error: "denied", errorProvider: "anthropic" });
    });

    it("should keep the progress log when the flow fails", () => {
      let state = reduceOAuthLogin(start(), { type: "event", event: { type: "progress", message: "step" } });
      state = reduceOAuthLogin(state, { type: "event", event: { type: "error", message: "denied" } });
      expect(state.log).toEqual(["step"]);
    });
  });

  describe("cancel", () => {
    it("should deactivate and drop the pending request when the user cancels", () => {
      let state = reduceOAuthLogin(start(), { type: "event", event: { type: "manual_code", id: "q1" } });
      state = reduceOAuthLogin(state, { type: "cancel" });
      expect(state.active).toBeNull();
      expect(state.request).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe("terminated", () => {
    it("should surface an unexpected-exit error when the process dies with a non-zero code", () => {
      const state = reduceOAuthLogin(start("openai"), { type: "terminated", code: 1 });
      expect(state.error).toBe("Login process exited unexpectedly.");
      expect(state.errorProvider).toBe("openai");
    });

    it("should not change state when the process exits with code 0", () => {
      const before = start();
      expect(reduceOAuthLogin(before, { type: "terminated", code: 0 })).toBe(before);
    });

    it("should not change state when the exit code is null", () => {
      const before = start();
      expect(reduceOAuthLogin(before, { type: "terminated", code: null })).toBe(before);
    });
  });
});
