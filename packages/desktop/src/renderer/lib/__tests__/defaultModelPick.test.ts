import { describe, expect, it } from "vitest";
import { defaultModelPatch, pickDefaultModel } from "../defaultModelPick";

const m = (provider: string, id: string) => ({ provider, id });

/** Stand-in for pi's table, with generic ids so the specs don't depend on
 *  whichever models pi favours today. */
const DEFAULTS = { alpha: "alpha-pro", beta: "beta-max" };

describe("pickDefaultModel()", () => {
  describe("for one provider", () => {
    it("should return the model named by the provider default", () => {
      const models = [m("alpha", "alpha-mini"), m("alpha", "alpha-pro"), m("alpha", "alpha-nano")];
      expect(pickDefaultModel(models, DEFAULTS, "alpha")).toBe("alpha/alpha-pro");
    });

    it("should match a dated release of the named model", () => {
      const models = [m("alpha", "alpha-mini"), m("alpha", "alpha-pro-20260115")];
      expect(pickDefaultModel(models, DEFAULTS, "alpha")).toBe("alpha/alpha-pro-20260115");
    });

    it("should pick the newest release when several match the named model", () => {
      const models = [
        m("alpha", "alpha-pro-20260115"),
        m("alpha", "alpha-pro-20251201"),
        m("alpha", "alpha-pro-20260320"),
      ];
      expect(pickDefaultModel(models, DEFAULTS, "alpha")).toBe("alpha/alpha-pro-20260320");
    });

    it("should prefer an exact match over a longer dated one", () => {
      const models = [m("alpha", "alpha-pro-20260320"), m("alpha", "alpha-pro")];
      expect(pickDefaultModel(models, DEFAULTS, "alpha")).toBe("alpha/alpha-pro");
    });

    it("should fall back to the first model when the provider has no default", () => {
      const models = [m("local", "qwen3-vl:8b"), m("local", "llama4:70b")];
      expect(pickDefaultModel(models, DEFAULTS, "local")).toBe("local/qwen3-vl:8b");
    });

    it("should fall back to the first model when the named default is unavailable", () => {
      const models = [m("alpha", "alpha-mini"), m("alpha", "alpha-nano")];
      expect(pickDefaultModel(models, DEFAULTS, "alpha")).toBe("alpha/alpha-mini");
    });

    it("should never return a model from another provider", () => {
      const models = [m("beta", "beta-max"), m("alpha", "alpha-mini")];
      expect(pickDefaultModel(models, DEFAULTS, "alpha")).toBe("alpha/alpha-mini");
    });

    it("should return undefined when the provider has no models", () => {
      expect(pickDefaultModel([m("beta", "beta-max")], DEFAULTS, "alpha")).toBeUndefined();
    });

    it("should return undefined when there are no models at all", () => {
      expect(pickDefaultModel([], DEFAULTS, "alpha")).toBeUndefined();
    });
  });

  describe("across providers", () => {
    it("should prefer a provider with a known default over an earlier one without", () => {
      const models = [m("local", "qwen3-vl:8b"), m("alpha", "alpha-mini"), m("alpha", "alpha-pro")];
      expect(pickDefaultModel(models, DEFAULTS)).toBe("alpha/alpha-pro");
    });

    it("should use the first provider that has a known default", () => {
      const models = [m("beta", "beta-max"), m("alpha", "alpha-pro")];
      expect(pickDefaultModel(models, DEFAULTS)).toBe("beta/beta-max");
    });

    it("should match a dated release when choosing across providers", () => {
      const models = [m("local", "qwen3-vl:8b"), m("beta", "beta-max-20260115")];
      expect(pickDefaultModel(models, DEFAULTS)).toBe("beta/beta-max-20260115");
    });

    it("should fall back to the very first model when no provider has a known default", () => {
      const models = [m("local", "qwen3-vl:8b"), m("alpha", "alpha-mini")];
      expect(pickDefaultModel(models, DEFAULTS)).toBe("local/qwen3-vl:8b");
    });

    it("should fall back to the first model when the table is empty", () => {
      const models = [m("alpha", "alpha-mini"), m("alpha", "alpha-pro")];
      expect(pickDefaultModel(models, {})).toBe("alpha/alpha-mini");
    });

    it("should return undefined when there are no models at all", () => {
      expect(pickDefaultModel([], DEFAULTS)).toBeUndefined();
    });
  });
});

describe("several providers connected", () => {
  it("should pick the recommended model of whichever provider comes first", () => {
    // Both providers have a recommended model available; beta is listed first.
    const models = [m("beta", "beta-mini"), m("beta", "beta-max"), m("alpha", "alpha-pro")];
    expect(pickDefaultModel(models, DEFAULTS)).toBe("beta/beta-max");
  });

  it("should skip a provider with no recommendation in favour of one with it", () => {
    const models = [m("local", "qwen3-vl:8b"), m("local", "llama4:70b"), m("beta", "beta-max")];
    expect(pickDefaultModel(models, DEFAULTS)).toBe("beta/beta-max");
  });

  it("should skip a provider whose recommended model is unavailable", () => {
    // alpha is listed first but only ships models pi does not name.
    const models = [m("alpha", "alpha-mini"), m("alpha", "alpha-nano"), m("beta", "beta-max")];
    expect(pickDefaultModel(models, DEFAULTS)).toBe("beta/beta-max");
  });

  it("should fall back to the first model overall when no provider has a recommendation", () => {
    const models = [m("local", "qwen3-vl:8b"), m("alpha", "alpha-mini")];
    expect(pickDefaultModel(models, DEFAULTS)).toBe("local/qwen3-vl:8b");
  });

  it("should keep the pick within the named provider when one is given", () => {
    // The just-connected provider wins even though beta also has a recommendation.
    const models = [m("beta", "beta-max"), m("alpha", "alpha-mini"), m("alpha", "alpha-pro")];
    expect(pickDefaultModel(models, DEFAULTS, "alpha")).toBe("alpha/alpha-pro");
  });
});

describe("defaultModelPatch()", () => {
  const models = [m("alpha", "alpha-mini"), m("alpha", "alpha-pro"), m("beta", "beta-max")];

  it("should set only the default when there is no allow-list", () => {
    expect(defaultModelPatch("alpha/alpha-pro", undefined, models)).toEqual({ defaultModel: "alpha/alpha-pro" });
  });

  it("should set only the default when the empty allow-list already means all enabled", () => {
    expect(defaultModelPatch("alpha/alpha-pro", [], models)).toEqual({ defaultModel: "alpha/alpha-pro" });
  });

  it("should set only the default when the allow-list already holds it", () => {
    expect(defaultModelPatch("alpha/alpha-pro", ["alpha/alpha-pro", "beta/beta-max"], models)).toEqual({
      defaultModel: "alpha/alpha-pro",
    });
  });

  it("should enable the default when the allow-list excludes it", () => {
    expect(defaultModelPatch("alpha/alpha-pro", ["beta/beta-max"], models)).toEqual({
      defaultModel: "alpha/alpha-pro",
      enabledModels: ["alpha/alpha-pro", "beta/beta-max"],
    });
  });

  it("should collapse the allow-list to all enabled when the default completes it", () => {
    expect(defaultModelPatch("alpha/alpha-pro", ["alpha/alpha-mini", "beta/beta-max"], models)).toEqual({
      defaultModel: "alpha/alpha-pro",
      enabledModels: [],
    });
  });

  it("should order the widened allow-list by the available models", () => {
    expect(defaultModelPatch("alpha/alpha-mini", ["beta/beta-max"], models).enabledModels).toEqual([
      "alpha/alpha-mini",
      "beta/beta-max",
    ]);
  });
});
