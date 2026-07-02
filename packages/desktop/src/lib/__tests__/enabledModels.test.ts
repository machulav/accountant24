import { describe, expect, it } from "vitest";
import { addEnabledModels, filterEnabledModels, modelId, parseModelId } from "../enabledModels";

const m = (provider: string, id: string) => ({ provider, modelId: id, name: `${provider}/${id}` });

const models = [m("anthropic", "claude-opus-4-8"), m("openai", "gpt-5.5"), m("ollama", "qwen3-vl:8b")];

describe("modelId", () => {
  it("joins provider and modelId with a slash", () => {
    expect(modelId({ provider: "anthropic", modelId: "claude-opus-4-8" })).toBe("anthropic/claude-opus-4-8");
  });
});

describe("parseModelId", () => {
  it("should split provider and modelId at the first slash", () => {
    expect(parseModelId("anthropic/claude-opus-4-8")).toEqual({ provider: "anthropic", modelId: "claude-opus-4-8" });
  });

  it("should keep later slashes in the modelId", () => {
    expect(parseModelId("openrouter/meta/llama-3")).toEqual({ provider: "openrouter", modelId: "meta/llama-3" });
  });

  it("should return undefined when the id has no slash", () => {
    expect(parseModelId("claude")).toBeUndefined();
  });

  it("should return undefined when the provider is empty (leading slash)", () => {
    expect(parseModelId("/model")).toBeUndefined();
  });

  it("should return undefined when the modelId is empty (trailing slash)", () => {
    expect(parseModelId("provider/")).toBeUndefined();
  });

  it("should return undefined when the id is only a slash", () => {
    expect(parseModelId("/")).toBeUndefined();
  });

  it("should return undefined when the id is empty", () => {
    expect(parseModelId("")).toBeUndefined();
  });

  it("should parse the minimal valid id of one char on each side", () => {
    expect(parseModelId("a/b")).toEqual({ provider: "a", modelId: "b" });
  });
});

describe("filterEnabledModels", () => {
  it("shows all when the selection is undefined", () => {
    expect(filterEnabledModels(models, undefined)).toEqual(models);
  });

  it("shows all when the selection is empty", () => {
    expect(filterEnabledModels(models, [])).toEqual(models);
  });

  it("keeps only the selected ids", () => {
    const out = filterEnabledModels(models, ["anthropic/claude-opus-4-8", "ollama/qwen3-vl:8b"]);
    expect(out.map(modelId)).toEqual(["anthropic/claude-opus-4-8", "ollama/qwen3-vl:8b"]);
  });

  it("preserves input order, not selection order", () => {
    const out = filterEnabledModels(models, ["openai/gpt-5.5", "anthropic/claude-opus-4-8"]);
    expect(out.map(modelId)).toEqual(["anthropic/claude-opus-4-8", "openai/gpt-5.5"]);
  });

  it("ignores ids that no longer exist", () => {
    const out = filterEnabledModels(models, ["anthropic/claude-opus-4-8", "openai/removed-model"]);
    expect(out.map(modelId)).toEqual(["anthropic/claude-opus-4-8"]);
  });

  it("falls back to all when the selection matches nothing available", () => {
    expect(filterEnabledModels(models, ["gone/model"])).toEqual(models);
  });

  it("does not mutate the input array", () => {
    const input = [...models];
    filterEnabledModels(input, []);
    expect(input).toEqual(models);
  });
});

describe("addEnabledModels", () => {
  const all = ["a/1", "a/2", "b/1", "b/2"];

  it("leaves 'show all' (undefined) unchanged", () => {
    expect(addEnabledModels(undefined, ["b/1", "b/2"], all)).toBeUndefined();
  });

  it("leaves 'show all' (empty) unchanged", () => {
    expect(addEnabledModels([], ["b/1"], all)).toEqual([]);
  });

  it("adds a newly-added provider's models to an explicit allow-list", () => {
    expect(addEnabledModels(["a/1"], ["b/1", "b/2"], all)).toEqual(["a/1", "b/1", "b/2"]);
  });

  it("preserves models intentionally left disabled for other providers", () => {
    // a/2 was off and stays off; only the new provider's model gets enabled.
    expect(addEnabledModels(["a/1"], ["b/1"], all)).toEqual(["a/1", "b/1"]);
  });

  it("collapses to [] when every available model ends up enabled", () => {
    expect(addEnabledModels(["a/1", "a/2", "b/1"], ["b/2"], all)).toEqual([]);
  });

  it("orders the result by availability, not insertion order", () => {
    expect(addEnabledModels(["b/2"], ["a/1"], all)).toEqual(["a/1", "b/2"]);
  });

  it("ignores ids to enable that aren't available", () => {
    expect(addEnabledModels(["a/1"], ["x/9"], all)).toEqual(["a/1"]);
  });

  it("is a no-op when the models are already enabled", () => {
    expect(addEnabledModels(["a/1", "b/1"], ["b/1"], all)).toEqual(["a/1", "b/1"]);
  });

  it("drops stale ids that are no longer available", () => {
    expect(addEnabledModels(["a/1", "gone/9"], ["b/1"], all)).toEqual(["a/1", "b/1"]);
  });
});
