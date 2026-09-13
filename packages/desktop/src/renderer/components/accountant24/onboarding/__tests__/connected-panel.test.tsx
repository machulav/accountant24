// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { ConnectedPanel } from "../connected-panel";

const MODELS: ModelInfo[] = [
  { provider: "anthropic", id: "claude-opus", name: "Claude Opus 4.8" },
  { provider: "anthropic", id: "claude-haiku", name: "Claude Haiku 4.5" },
];

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => cleanup());

const renderPanel = (props: Partial<Parameters<typeof ConnectedPanel>[0]> = {}) => {
  const onOpen = vi.fn();
  const onSelectDefault = vi.fn();
  render(
    <ConnectedPanel
      providerName="Anthropic"
      models={MODELS}
      defaultModel="anthropic/claude-opus"
      onSelectDefault={onSelectDefault}
      saveError={null}
      onOpen={onOpen}
      {...props}
    />,
  );
  return { onOpen, onSelectDefault };
};

describe("ConnectedPanel", () => {
  it("should confirm which provider is connected", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Connected to Anthropic" })).toBeInTheDocument();
  });

  it("should show the model that was picked for the user", () => {
    renderPanel();
    expect(screen.getByRole("combobox")).toHaveTextContent("Claude Opus 4.8");
    expect(screen.getByText(/The model new chats start with/)).toBeInTheDocument();
  });

  it("should let the user choose a different model", async () => {
    const { onSelectDefault } = renderPanel();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /Claude Haiku 4.5/ }));
    await waitFor(() => expect(onSelectDefault).toHaveBeenCalledExactlyOnceWith("anthropic/claude-haiku"));
  });

  it("should open the app when asked", () => {
    const { onOpen } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open Accountant24" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("should hold the app closed until a model is available", () => {
    renderPanel({ models: [], defaultModel: undefined });
    expect(screen.getByRole("button", { name: "Open Accountant24" })).toBeDisabled();
  });

  it("should surface a failure to save the model choice", () => {
    renderPanel({ saveError: "Couldn't save settings: disk full" });
    expect(screen.getByText("Couldn't save settings: disk full")).toBeInTheDocument();
  });
});
