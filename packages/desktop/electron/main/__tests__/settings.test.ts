import { beforeEach, describe, expect, it, vi } from "vitest";

// settings.ts persists app config in ~/Accountant24/app-settings.json. The fs is
// the faked I/O boundary (an in-memory file map, so persistence semantics are
// real); the module's own logic — key filtering, merging, one-time markers —
// runs for real.
type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  handlers: new Map<string, Handler>(),
}));

vi.mock("node:fs", () => ({
  existsSync: (p: string) => h.files.has(p),
  mkdirSync: () => {},
  readFileSync: (p: string) => {
    const content = h.files.get(p);
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  },
  writeFileSync: (p: string, data: string) => {
    h.files.set(p, String(data));
  },
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
}));
vi.mock("../env", () => ({ workspaceDir: () => "/ws" }));

const SETTINGS_PATH = "/ws/app-settings.json";

async function setup() {
  return await import("../settings");
}

/** The current parsed content of app-settings.json. */
const stored = (): Record<string, unknown> => JSON.parse(h.files.get(SETTINGS_PATH) ?? "{}");

const seed = (settings: Record<string, unknown>) => h.files.set(SETTINGS_PATH, JSON.stringify(settings));

beforeEach(() => {
  h.files.clear();
  h.handlers.clear();
  vi.resetModules();
});

describe("consumeOnce()", () => {
  it("should return true on the first call for a key and false on every later call", async () => {
    const { consumeOnce } = await setup();
    expect(consumeOnce("first_user_message_sent")).toBe(true);
    expect(consumeOnce("first_user_message_sent")).toBe(false);
    expect(consumeOnce("first_user_message_sent")).toBe(false);
  });

  it("should track different keys independently", async () => {
    const { consumeOnce } = await setup();
    expect(consumeOnce("a")).toBe(true);
    expect(consumeOnce("b")).toBe(true);
    expect(consumeOnce("a")).toBe(false);
  });

  it("should persist consumed keys so a fresh process still returns false", async () => {
    const first = await setup();
    first.consumeOnce("first_user_message_sent");

    vi.resetModules();
    const second = await setup();
    expect(second.consumeOnce("first_user_message_sent")).toBe(false);
  });

  it("should append to onceEvents in the settings file without touching other keys", async () => {
    seed({ defaultModel: "anthropic/claude", analyticsEnabled: false });
    const { consumeOnce } = await setup();
    consumeOnce("a");
    consumeOnce("b");
    expect(stored()).toEqual({
      defaultModel: "anthropic/claude",
      analyticsEnabled: false,
      onceEvents: ["a", "b"],
    });
  });

  it("should honor keys already consumed in a hand-edited file and ignore non-string entries", async () => {
    seed({ onceEvents: ["done", 5, null] });
    const { consumeOnce } = await setup();
    expect(consumeOnce("done")).toBe(false);
    expect(consumeOnce("new")).toBe(true);
    expect(stored().onceEvents).toEqual(["done", "new"]);
  });

  it("should ignore the legacy firstLaunchDone flag (accepted: such installs re-emit app_installed once)", async () => {
    seed({ firstLaunchDone: true });
    const { consumeOnce } = await setup();
    expect(consumeOnce("app_installed")).toBe(true);
    expect(consumeOnce("app_installed")).toBe(false);
  });
});

describe("isAnalyticsEnabled()", () => {
  it("should default to true when nothing is stored", async () => {
    const { isAnalyticsEnabled } = await setup();
    expect(isAnalyticsEnabled()).toBe(true);
  });

  it("should return false after the user opts out", async () => {
    seed({ analyticsEnabled: false });
    const { isAnalyticsEnabled } = await setup();
    expect(isAnalyticsEnabled()).toBe(false);
  });
});

describe("settings_set IPC", () => {
  it("should merge a patch without dropping consumed one-time markers", async () => {
    const { consumeOnce, registerSettingsIpc } = await setup();
    registerSettingsIpc();
    consumeOnce("first_user_message_sent");

    h.handlers.get("settings_set")?.(null, { analyticsEnabled: false });
    expect(stored()).toMatchObject({
      analyticsEnabled: false,
      onceEvents: ["first_user_message_sent"],
    });
  });
});
