// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type ModelOption, ModelSelector } from "../model-selector";

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
});

afterEach(() => {
  cleanup();
});

const MODELS: ModelOption[] = [
  { id: "anthropic/fable", name: "Claude Fable 5", description: "anthropic" },
  { id: "anthropic/haiku", name: "Claude Haiku 4.5", description: "anthropic" },
  { id: "openai/gpt", name: "GPT-5.5", description: "openai" },
];

const renderSelector = (value?: string) => {
  const onValueChange = vi.fn();
  render(
    <ModelSelector
      models={MODELS}
      {...(value !== undefined ? { value } : {})}
      onValueChange={onValueChange}
      searchable
    />,
  );
  return onValueChange;
};

const openPopup = async () => {
  fireEvent.click(screen.getByRole("combobox"));
  await screen.findByPlaceholderText("Search models...");
};

const itemNames = () =>
  screen.queryAllByRole("option").map((el) => el.querySelector(".truncate")?.textContent ?? el.textContent);

describe("ModelSelector", () => {
  it("should show the selected model's name in the trigger", () => {
    renderSelector("anthropic/fable");
    expect(screen.getByRole("combobox").textContent).toContain("Claude Fable 5");
  });

  it("should show the placeholder when nothing is selected", () => {
    renderSelector();
    expect(screen.getByRole("combobox").textContent).toContain("Select model");
  });

  it("should list all models when opened", async () => {
    renderSelector("anthropic/fable");
    await openPopup();
    expect(itemNames()).toEqual(["Claude Fable 5", "Claude Haiku 4.5", "GPT-5.5"]);
  });

  it("should narrow the list when searching by name", async () => {
    renderSelector("anthropic/fable");
    await openPopup();
    fireEvent.change(screen.getByPlaceholderText("Search models..."), { target: { value: "haiku" } });
    await waitFor(() => expect(itemNames()).toEqual(["Claude Haiku 4.5"]));
  });

  it("should match the model id (provider) in addition to the name", async () => {
    renderSelector("anthropic/fable");
    await openPopup();
    fireEvent.change(screen.getByPlaceholderText("Search models..."), { target: { value: "openai" } });
    await waitFor(() => expect(itemNames()).toEqual(["GPT-5.5"]));
  });

  it("should show an empty state when nothing matches", async () => {
    renderSelector("anthropic/fable");
    await openPopup();
    fireEvent.change(screen.getByPlaceholderText("Search models..."), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText("No models found.")).toBeDefined());
  });

  it("should report the picked model id and close the popup on select", async () => {
    const onValueChange = renderSelector("anthropic/fable");
    await openPopup();
    fireEvent.click(screen.getByText("GPT-5.5"));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    expect(onValueChange).toHaveBeenCalledWith("openai/gpt");
  });
});
