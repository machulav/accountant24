// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthLogin } from "@/hooks/use-oauth-login";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { OAuthConnect } from "../oauth-connect";

// The flow itself is driven by the caller's OAuthLogin; here it is a stub so
// every state of a sign-in can be rendered on demand.
const login = (o: Partial<OAuthLogin> = {}): OAuthLogin => ({
  active: null,
  log: [],
  request: null,
  authUrl: null,
  deviceCode: null,
  error: null,
  errorProvider: null,
  start: vi.fn(),
  respond: vi.fn(),
  cancel: vi.fn(),
  dismissError: vi.fn(),
  ...o,
});

const renderPanel = (oauth: OAuthLogin, loginLabel?: string, provider = "anthropic") =>
  render(
    <OAuthConnect
      providerId={provider}
      providerName="Anthropic"
      oauthName="Anthropic (Claude Pro/Max)"
      {...(loginLabel ? { loginLabel } : {})}
      oauth={oauth}
    />,
  );

beforeEach(() => installJsdomPolyfills());
afterEach(() => cleanup());

describe("OAuthConnect", () => {
  it("should say the plan runs the model and the chats stay out of reach, for a known product", () => {
    renderPanel(login());
    expect(
      screen.getByText("Your Claude Pro or Max plan runs the model. Accountant24 gets no access to your Claude chats."),
    ).toBeInTheDocument();
  });

  it("should fall back to pi's name for the subscription of any other provider", () => {
    renderPanel(login(), undefined, "kimi-coding");
    expect(screen.getByText("Use your Anthropic (Claude Pro/Max) subscription to run the model.")).toBeInTheDocument();
  });

  it("should start the sign-in for its own provider", () => {
    const oauth = login();
    renderPanel(oauth);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Anthropic" }));
    expect(oauth.start).toHaveBeenCalledExactlyOnceWith("anthropic");
  });

  it("should use the provider's own wording for the action when there is one", () => {
    renderPanel(login(), "Sign in with SuperGrok or X Premium");
    expect(screen.getByRole("button", { name: "Sign in with SuperGrok or X Premium" })).toBeInTheDocument();
  });

  it("should show the flow's progress once it is running", () => {
    renderPanel(login({ active: "anthropic", log: ["Opened your browser to authorize."] }));
    expect(screen.getByText("Opened your browser to authorize.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Anthropic" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("should show a device code to enter elsewhere", () => {
    renderPanel(
      login({ active: "anthropic", deviceCode: { userCode: "ABCD-1234", verificationUri: "https://example.test/dc" } }),
    );
    expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.test/dc" })).toBeInTheDocument();
  });

  it("should offer the sign-in page when the browser did not open", () => {
    renderPanel(login({ active: "anthropic", authUrl: "https://example.test/auth" }));
    expect(screen.getByRole("link", { name: "Open the sign-in page" })).toHaveAttribute(
      "href",
      "https://example.test/auth",
    );
  });

  it("should answer a question the flow asks", () => {
    const oauth = login({
      active: "anthropic",
      request: { id: "q1", kind: "prompt", message: "Paste the code" },
    });
    renderPanel(oauth);
    fireEvent.change(screen.getByLabelText("Paste the code"), { target: { value: "xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(oauth.respond).toHaveBeenCalledExactlyOnceWith("xyz");
  });

  it("should offer the options of a choice the flow asks for", () => {
    const oauth = login({
      active: "anthropic",
      request: { id: "q1", kind: "select", message: "Which plan?", options: [{ id: "max", label: "Max" }] },
    });
    renderPanel(oauth);
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(oauth.respond).toHaveBeenCalledExactlyOnceWith("max");
  });

  it("should abort a running sign-in on Cancel", () => {
    const oauth = login({ active: "anthropic" });
    renderPanel(oauth);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(oauth.cancel).toHaveBeenCalledTimes(1);
  });

  it("should keep a failure on screen until it is dismissed", () => {
    const oauth = login({ error: "Login cancelled", errorProvider: "anthropic" });
    renderPanel(oauth);
    expect(screen.getByText("Login cancelled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(oauth.dismissError).toHaveBeenCalledTimes(1);
    expect(oauth.cancel).not.toHaveBeenCalled();
  });

  it("should ignore a sign-in running for another provider", () => {
    renderPanel(login({ active: "openai", log: ["Opened your browser to authorize."] }));
    expect(screen.getByRole("button", { name: "Sign in with Anthropic" })).toBeInTheDocument();
    expect(screen.queryByText("Opened your browser to authorize.")).toBeNull();
  });
});
