import { describe, expect, it } from "vitest";
import { pluginRepo } from "@/lib/pluginRepo";

describe("pluginRepo()", () => {
  it("should link to the repository a plugin was installed from", () => {
    expect(pluginRepo({ source: "acme/budget" })).toEqual({
      label: "acme/budget",
      url: "https://github.com/acme/budget",
    });
  });

  it("should link to the repository the manifest declares when nothing else is known", () => {
    expect(pluginRepo({ repository: "https://github.com/acme/budget" })).toEqual({
      label: "acme/budget",
      url: "https://github.com/acme/budget",
    });
  });

  it("should prefer where the plugin came from over what its manifest claims", () => {
    expect(pluginRepo({ source: "acme/budget", repository: "https://github.com/someone-else/budget" })?.label).toBe(
      "acme/budget",
    );
  });

  it("should accept a manifest repository given as owner/repo", () => {
    expect(pluginRepo({ repository: "acme/budget" })?.url).toBe("https://github.com/acme/budget");
  });

  it("should accept a git URL and a trailing slash", () => {
    expect(pluginRepo({ repository: "https://github.com/acme/budget.git" })?.label).toBe("acme/budget");
    expect(pluginRepo({ repository: "https://github.com/acme/budget/" })?.label).toBe("acme/budget");
  });

  it("should accept the www host", () => {
    expect(pluginRepo({ repository: "https://www.github.com/acme/budget" })?.label).toBe("acme/budget");
  });

  it("should ignore surrounding whitespace", () => {
    expect(pluginRepo({ source: "  acme/budget  " })?.label).toBe("acme/budget");
  });

  it("should link nothing when the plugin was dropped in by hand", () => {
    expect(pluginRepo({})).toBeUndefined();
  });

  it("should link nothing when the manifest points somewhere other than GitHub", () => {
    expect(pluginRepo({ repository: "https://gitlab.com/acme/budget" })).toBeUndefined();
  });

  it("should link nothing when the manifest repository is not a repository at all", () => {
    expect(pluginRepo({ repository: "acme" })).toBeUndefined();
    expect(pluginRepo({ repository: "https://github.com/acme" })).toBeUndefined();
  });

  it("should fall back to the manifest when the source is empty", () => {
    expect(pluginRepo({ source: "", repository: "acme/budget" })?.label).toBe("acme/budget");
  });
});
