import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { findModel, MODEL_CONFIG_ID, modelConfigOption, type PiModel, selectableModels } from "../models";

const anthropic: PiModel = { provider: "anthropic", id: "claude-sonnet-5", name: "Claude Sonnet 5" };
const openai: PiModel = { provider: "openai", id: "gpt-5.5", name: "GPT-5.5" };
// A model id containing a slash — the provider is only the part before the first one.
const ollama: PiModel = { provider: "ollama", id: "library/qwen3", name: "Qwen 3" };
const all = [anthropic, openai, ollama];

/** Narrow the config-option union to the select variant's choices. */
const selectOptions = (option: SessionConfigOption | undefined) =>
  option && option.type === "select" ? option.options : undefined;

describe("selectableModels()", () => {
  it("should return every model when no selection is stored", () => {
    expect(selectableModels(all, undefined)).toEqual(all);
  });

  it("should return every model when the selection is empty (the 'all' sentinel)", () => {
    expect(selectableModels(all, [])).toEqual(all);
  });

  it("should keep only the enabled models, in registry order", () => {
    expect(selectableModels(all, ["openai/gpt-5.5", "anthropic/claude-sonnet-5"])).toEqual([anthropic, openai]);
  });

  it("should match a model id that itself contains a slash", () => {
    expect(selectableModels(all, ["ollama/library/qwen3"])).toEqual([ollama]);
  });

  it("should fall back to all models when the selection matches nothing available", () => {
    expect(selectableModels(all, ["removed/model"])).toEqual(all);
  });

  it("should return nothing when no models are available at all", () => {
    expect(selectableModels([], ["anthropic/claude-sonnet-5"])).toEqual([]);
  });
});

describe("modelConfigOption()", () => {
  it("should build a select option in the model category", () => {
    expect(modelConfigOption(all, undefined, openai)).toEqual({
      id: MODEL_CONFIG_ID,
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "openai/gpt-5.5",
      options: [
        { value: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
        { value: "openai/gpt-5.5", name: "GPT-5.5" },
        { value: "ollama/library/qwen3", name: "Qwen 3" },
      ],
    });
  });

  it("should return undefined when no model is available, so no picker is advertised", () => {
    expect(modelConfigOption([], undefined, undefined)).toBeUndefined();
  });

  it("should default currentValue to the first selectable model when none is active", () => {
    expect(modelConfigOption(all, undefined, undefined)?.currentValue).toBe("anthropic/claude-sonnet-5");
  });

  it("should list only enabled models", () => {
    expect(selectOptions(modelConfigOption(all, ["openai/gpt-5.5"], openai))).toEqual([
      { value: "openai/gpt-5.5", name: "GPT-5.5" },
    ]);
  });

  it("should fall back to the model id when the model has no display name", () => {
    expect(selectOptions(modelConfigOption([{ provider: "custom", id: "my-model" }], undefined, undefined))).toEqual([
      { value: "custom/my-model", name: "my-model" },
    ]);
  });
});

describe("findModel()", () => {
  it("should resolve a provider/modelId id", () => {
    expect(findModel(all, "openai/gpt-5.5")).toBe(openai);
  });

  it("should resolve an id whose model part contains a slash", () => {
    expect(findModel(all, "ollama/library/qwen3")).toBe(ollama);
  });

  it("should return undefined for an unknown model", () => {
    expect(findModel(all, "openai/nope")).toBeUndefined();
  });

  it.each([
    ["no slash", "gpt-5.5"],
    ["empty provider", "/gpt-5.5"],
    ["empty model", "openai/"],
    ["empty string", ""],
  ])("should return undefined for a malformed id (%s)", (_label, id) => {
    expect(findModel(all, id)).toBeUndefined();
  });
});
