// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// IPC boundary: the API-key dialog saves the pasted key over the Electron bridge.
vi.mock("@/rpc/api", () => ({
  authApi: { setKey: vi.fn() },
}));

import type { OAuthLogin } from "@/components/auth/useOAuthLogin";
import { authApi } from "@/rpc/api";
import type { AuthProviderRow } from "@/rpc/types";
import { ApiKeyDialog, OAuthSignInDialog } from "../provider-dialogs";

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
});

const provider = (o: Partial<AuthProviderRow> = {}): AuthProviderRow => ({
  provider: "openai",
  displayName: "OpenAI",
  oauth: false,
  configured: false,
  ...o,
});

// ---- ApiKeyDialog -------------------------------------------------------

describe("ApiKeyDialog", () => {
  beforeEach(() => {
    vi.mocked(authApi.setKey).mockResolvedValue({ type: "ok" });
  });

  it("should not render the dialog when no provider is given", () => {
    render(<ApiKeyDialog provider={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByText("Connect OpenAI")).not.toBeInTheDocument();
  });

  it("should show a connect title naming the provider when open", () => {
    render(<ApiKeyDialog provider={provider()} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("Connect OpenAI")).toBeInTheDocument();
  });

  it("should disable the Connect button when the key is empty", () => {
    render(<ApiKeyDialog provider={provider()} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("should disable the Connect button when the key is only whitespace", () => {
    render(<ApiKeyDialog provider={provider()} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("should enable the Connect button when a non-empty key is typed", () => {
    render(<ApiKeyDialog provider={provider()} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-123" } });
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("should save the trimmed key for the provider and call onSaved on success", async () => {
    const onSaved = vi.fn();
    render(<ApiKeyDialog provider={provider()} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "  sk-abc  " } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(authApi.setKey).toHaveBeenCalledWith("openai", "sk-abc");
  });

  it("should save when Enter is pressed in the key field", async () => {
    const onSaved = vi.fn();
    render(<ApiKeyDialog provider={provider()} onClose={vi.fn()} onSaved={onSaved} />);
    const input = screen.getByLabelText("API Key");
    fireEvent.change(input, { target: { value: "sk-xyz" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(authApi.setKey).toHaveBeenCalledWith("openai", "sk-xyz"));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("should surface an error result in the banner and not call onSaved", async () => {
    vi.mocked(authApi.setKey).mockResolvedValue({ type: "error", message: "Invalid key" });
    const onSaved = vi.fn();
    render(<ApiKeyDialog provider={provider()} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid key"));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("should toggle the key visibility control between show and hide", () => {
    render(<ApiKeyDialog provider={provider()} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Show API key" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show API key" }));
    expect(screen.getByRole("button", { name: "Hide API key" })).toBeInTheDocument();
  });

  it("should call onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<ApiKeyDialog provider={provider()} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---- OAuthSignInDialog --------------------------------------------------

const baseOAuth: OAuthLogin = {
  active: "anthropic",
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
};

const makeOAuth = (o: Partial<OAuthLogin> = {}): OAuthLogin => ({
  ...baseOAuth,
  start: vi.fn(),
  respond: vi.fn(),
  cancel: vi.fn(),
  dismissError: vi.fn(),
  ...o,
});

const oauthProvider = (o: Partial<AuthProviderRow> = {}): AuthProviderRow => ({
  provider: "anthropic",
  displayName: "Anthropic",
  oauth: true,
  configured: false,
  ...o,
});

describe("OAuthSignInDialog", () => {
  it("should not render the dialog when no provider is given", () => {
    render(<OAuthSignInDialog provider={null} oauth={makeOAuth()} />);
    expect(screen.queryByText("Sign in to Anthropic")).not.toBeInTheDocument();
  });

  it("should show a sign-in title naming the provider when open", () => {
    render(<OAuthSignInDialog provider={oauthProvider()} oauth={makeOAuth()} />);
    expect(screen.getByText("Sign in to Anthropic")).toBeInTheDocument();
  });

  it("should render each progress log line", () => {
    const oauth = makeOAuth({ active: "anthropic", log: ["Opened your browser", "Waiting for authorization"] });
    render(<OAuthSignInDialog provider={oauthProvider()} oauth={oauth} />);
    expect(screen.getByText("Opened your browser")).toBeInTheDocument();
    expect(screen.getByText("Waiting for authorization")).toBeInTheDocument();
  });

  it("should offer a manual sign-in link while waiting on the browser", () => {
    const oauth = makeOAuth({ active: "anthropic", authUrl: "https://auth.example/login", log: ["Opened browser"] });
    render(<OAuthSignInDialog provider={oauthProvider()} oauth={oauth} />);
    const link = screen.getByRole("link", { name: "Open the sign-in page" });
    expect(link).toHaveAttribute("href", "https://auth.example/login");
  });

  it("should not offer the manual sign-in link once a request is pending", () => {
    // `waiting` is false while a request is on screen, so the fallback link hides.
    const oauth = makeOAuth({
      active: "anthropic",
      authUrl: "https://auth.example/login",
      request: { id: "r1", kind: "prompt", message: "Enter code" },
    });
    render(<OAuthSignInDialog provider={oauthProvider()} oauth={oauth} />);
    expect(screen.queryByRole("link", { name: "Open the sign-in page" })).not.toBeInTheDocument();
  });

  it("should render a device code and its verification link", () => {
    const oauth = makeOAuth({
      active: "anthropic",
      deviceCode: { userCode: "WDJB-MJHT", verificationUri: "https://github.com/device" },
    });
    render(<OAuthSignInDialog provider={oauthProvider()} oauth={oauth} />);
    expect(screen.getByText("WDJB-MJHT")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://github.com/device" })).toHaveAttribute(
      "href",
      "https://github.com/device",
    );
  });

  it("should render select options and answer with the chosen option id", () => {
    const oauth = makeOAuth({
      active: "anthropic",
      request: {
        id: "r1",
        kind: "select",
        message: "Choose an account",
        options: [
          { id: "acc-a", label: "Account A" },
          { id: "acc-b", label: "Account B" },
        ],
      },
    });
    render(<OAuthSignInDialog provider={oauthProvider()} oauth={oauth} />);
    expect(screen.getByText("Choose an account")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Account B" }));
    expect(oauth.respond).toHaveBeenCalledWith("acc-b");
  });

  it("should render a prompt request and disable Continue until the answer is non-empty", () => {
    const oauth = makeOAuth({
      active: "anthropic",
      request: { id: "r1", kind: "prompt", message: "Enter your org", allowEmpty: false },
    });
    render(<OAuthSignInDialog provider={oauthProvider()} oauth={oauth} />);
    expect(screen.getByText("Enter your org")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Enter your org"), { target: { value: "acme" } });
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(oauth.respond).toHaveBeenCalledWith("acme");
  });

  it("should allow submitting a blank answer when the prompt allows empty", () => {
    const oauth = makeOAuth({
      active: "github-copilot",
      request: { id: "r1", kind: "prompt", message: "Domain?", allowEmpty: true },
    });
    render(
      <OAuthSignInDialog
        provider={oauthProvider({ provider: "github-copilot", displayName: "GitHub Copilot" })}
        oauth={oauth}
      />,
    );
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(oauth.respond).toHaveBeenCalledWith("");
  });

  it("should relabel the GitHub Copilot domain prompt", () => {
    const oauth = makeOAuth({
      active: "github-copilot",
      request: { id: "r1", kind: "prompt", message: "Enter GitHub host", allowEmpty: true },
    });
    render(
      <OAuthSignInDialog
        provider={oauthProvider({ provider: "github-copilot", displayName: "GitHub Copilot" })}
        oauth={oauth}
      />,
    );
    expect(screen.getByText("GitHub Enterprise domain (optional)")).toBeInTheDocument();
  });

  it("should show the error and dismiss it via the Close button after a failure", () => {
    const oauth = makeOAuth({ active: null, error: "Sign-in failed", errorProvider: "anthropic" });
    render(<OAuthSignInDialog provider={oauthProvider()} oauth={oauth} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in failed");
    // "Close" also matches the dialog's built-in icon X; the footer button is
    // the text-only one.
    const footerClose = screen.getAllByRole("button", { name: "Close" }).find((b) => b.querySelector("svg") === null);
    fireEvent.click(footerClose as HTMLElement);
    expect(oauth.dismissError).toHaveBeenCalledTimes(1);
    expect(oauth.cancel).not.toHaveBeenCalled();
  });

  it("should cancel an in-progress sign-in via the Cancel button", () => {
    const oauth = makeOAuth({ active: "anthropic", log: ["Starting"] });
    render(<OAuthSignInDialog provider={oauthProvider()} oauth={oauth} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(oauth.cancel).toHaveBeenCalledTimes(1);
    expect(oauth.dismissError).not.toHaveBeenCalled();
  });
});
