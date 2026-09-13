// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setKey = vi.hoisted(() => vi.fn());
vi.mock("@/rpc/api", () => ({ authApi: { setKey } }));

import { ApiKeyConnect } from "../api-key-connect";

beforeEach(() => setKey.mockResolvedValue({ type: "done", provider: "anthropic" }));
afterEach(() => cleanup());

const renderPanel = (onConnected = vi.fn()) => {
  render(<ApiKeyConnect providerId="anthropic" providerName="Anthropic" onConnected={onConnected} />);
  return onConnected;
};

const field = () => screen.getByLabelText("API Key");

describe("ApiKeyConnect", () => {
  it("should name the provider the key belongs to and say where it is kept", () => {
    renderPanel();
    expect(screen.getByText(/Paste an API key from your Anthropic account/)).toBeInTheDocument();
    expect(screen.getByText(/stored only on this device/)).toBeInTheDocument();
  });

  it("should keep Connect unavailable until a key is typed", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    fireEvent.change(field(), { target: { value: "sk-test" } });
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("should treat blank space as no key", () => {
    renderPanel();
    fireEvent.change(field(), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("should store the trimmed key for the chosen provider and report success", async () => {
    const onConnected = renderPanel();
    fireEvent.change(field(), { target: { value: "  sk-test  " } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(setKey).toHaveBeenCalledExactlyOnceWith("anthropic", "sk-test");
  });

  it("should submit on Enter", async () => {
    const onConnected = renderPanel();
    fireEvent.change(field(), { target: { value: "sk-test" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
  });

  it("should hide the key until the reveal is used", () => {
    renderPanel();
    expect(field()).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show API key" }));
    expect(field()).toHaveAttribute("type", "text");
  });

  it("should surface a rejected key without reporting success", async () => {
    setKey.mockResolvedValue({ type: "error", message: "invalid key" });
    const onConnected = renderPanel();
    fireEvent.change(field(), { target: { value: "sk-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText(/invalid key/)).toBeInTheDocument();
    expect(onConnected).not.toHaveBeenCalled();
  });
});
