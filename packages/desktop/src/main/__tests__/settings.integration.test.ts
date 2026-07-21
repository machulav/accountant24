// Integration: app-settings persistence over a REAL filesystem (a temp
// ACCOUNTANT24_HOME via makeTmpWorkspace). Unlike the unit test (settings.test.ts,
// in-memory fs map), this exercises the actual node:fs round-trip + the legacy
// migration end-to-end. Only `electron` is faked (the IPC boundary).

import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTmpWorkspace } from "./tmpWorkspace";

type Handler = (event: unknown, payload?: unknown) => unknown;
const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => h.handlers.set(channel, fn) },
  app: { isPackaged: false, getAppPath: () => "/app" },
}));

const ws = makeTmpWorkspace();

/** Fresh module + handlers against the current temp workspace. */
async function load(opts?: { onAnalyticsToggled?: (enabled: boolean) => void }) {
  vi.resetModules();
  h.handlers.clear();
  const mod = await import("../settings");
  mod.registerSettingsIpc(opts);
  return mod;
}

const get = (): Record<string, unknown> => h.handlers.get("settings_get")?.({}) as Record<string, unknown>;
const set = (patch: unknown): Record<string, unknown> =>
  h.handlers.get("settings_set")?.({}, patch) as Record<string, unknown>;

const readJson = (name: string) => JSON.parse(readFileSync(ws.path(name), "utf8"));

beforeEach(() => {
  ws.setup();
});
afterEach(() => {
  ws.cleanup();
});

describe("settings persistence (real fs)", () => {
  it("should return empty settings when no file exists yet", async () => {
    await load();
    expect(get()).toEqual({});
  });

  it("should persist a set and read it back from app-settings.json on disk", async () => {
    await load();
    const merged = set({ defaultModel: "anthropic/opus" });
    expect(merged).toEqual({ defaultModel: "anthropic/opus" });
    expect(readJson("app-settings.json")).toEqual({ defaultModel: "anthropic/opus" });
    expect(get()).toEqual({ defaultModel: "anthropic/opus" });
  });

  it("should merge-patch rather than replace on successive sets", async () => {
    await load();
    set({ enabledModels: ["a/1", "b/2"] });
    const merged = set({ defaultModel: "a/1" });
    expect(merged).toEqual({ enabledModels: ["a/1", "b/2"], defaultModel: "a/1" });
  });

  it("should ignore foreign (pi) keys present in the file", async () => {
    await load();
    // Seed the file with an app key + a pi-owned key.
    writeFileSync(ws.path("app-settings.json"), JSON.stringify({ defaultModel: "a/1", defaultProvider: "pi-thing" }));
    expect(get()).toEqual({ defaultModel: "a/1" });
  });

  it("should fold a legacy object-form defaultModel into the id string", async () => {
    await load();
    writeFileSync(
      ws.path("app-settings.json"),
      JSON.stringify({ defaultModel: { provider: "anthropic", modelId: "opus" } }),
    );
    expect(get()).toEqual({ defaultModel: "anthropic/opus" });
  });

  describe("legacy migration (settings.json -> app-settings.json)", () => {
    it("should move app keys out and leave pi keys behind", async () => {
      await load();
      // Only the legacy shared file exists, mixing app + pi keys.
      writeFileSync(
        ws.path("settings.json"),
        JSON.stringify({ defaultModel: "a/1", enabledModels: ["a/1"], defaultProvider: "pi" }),
      );

      expect(get()).toEqual({ defaultModel: "a/1", enabledModels: ["a/1"] });
      // app-settings.json now holds our keys...
      expect(readJson("app-settings.json")).toEqual({ defaultModel: "a/1", enabledModels: ["a/1"] });
      // ...and settings.json keeps only pi's.
      expect(readJson("settings.json")).toEqual({ defaultProvider: "pi" });
    });

    it("should prefer an existing app-settings.json over the legacy file", async () => {
      await load();
      writeFileSync(ws.path("app-settings.json"), JSON.stringify({ defaultModel: "new/model" }));
      writeFileSync(ws.path("settings.json"), JSON.stringify({ defaultModel: "old/model" }));
      expect(get()).toEqual({ defaultModel: "new/model" });
    });
  });

  describe("consumeOnce()", () => {
    it("should return true the first time and false thereafter, persisting the key", async () => {
      const mod = await load();
      expect(mod.consumeOnce("app_installed")).toBe(true);
      expect(mod.consumeOnce("app_installed")).toBe(false);
      expect(readJson("app-settings.json").onceEvents).toEqual(["app_installed"]);
    });

    it("should track distinct keys independently", async () => {
      const mod = await load();
      expect(mod.consumeOnce("a")).toBe(true);
      expect(mod.consumeOnce("b")).toBe(true);
      expect(readJson("app-settings.json").onceEvents).toEqual(["a", "b"]);
    });
  });

  describe("analytics toggle callback", () => {
    it("should invoke onAnalyticsToggled only when the value actually flips", async () => {
      const onAnalyticsToggled = vi.fn();
      await load({ onAnalyticsToggled });

      set({ defaultModel: "a/1" }); // unrelated change — no flip
      expect(onAnalyticsToggled).not.toHaveBeenCalled();

      set({ analyticsEnabled: false }); // on (default) -> off
      expect(onAnalyticsToggled).toHaveBeenLastCalledWith(false);

      set({ analyticsEnabled: false }); // already off — no flip
      expect(onAnalyticsToggled).toHaveBeenCalledTimes(1);

      set({ analyticsEnabled: true }); // off -> on
      expect(onAnalyticsToggled).toHaveBeenLastCalledWith(true);
      expect(onAnalyticsToggled).toHaveBeenCalledTimes(2);
    });
  });

  it("should report analytics enabled by default and reflect an opt-out", async () => {
    const mod = await load();
    expect(mod.isAnalyticsEnabled()).toBe(true);
    set({ analyticsEnabled: false });
    expect(mod.isAnalyticsEnabled()).toBe(false);
  });
});
