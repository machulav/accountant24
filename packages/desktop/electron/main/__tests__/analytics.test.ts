import { beforeEach, describe, expect, it, vi } from "vitest";

// analytics.ts gates every event on the opt-out and owns the one-time
// (install / milestone) semantics. The Aptabase SDK (network), Electron IPC, and
// the settings file's fs are the faked I/O boundaries; the real settings module
// runs on an in-memory file map so opt-out and marker persistence are exercised
// for real.
type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  handlers: new Map<string, Handler>(),
  trackEvent: vi.fn(),
  initialize: vi.fn(),
}));

vi.mock("@aptabase/electron/main", () => ({
  initialize: h.initialize,
  trackEvent: h.trackEvent,
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
vi.mock("../env", () => ({
  workspaceDir: () => "/ws",
  appSettingsPath: () => "/ws/app-settings.json",
  legacySettingsPath: () => "/ws/settings.json",
}));

const SETTINGS_PATH = "/ws/app-settings.json";

async function setup() {
  return await import("../analytics");
}

/** Merge a patch into the settings file directly (as the Settings UI would). */
function patchSettings(patch: Record<string, unknown>) {
  const current = JSON.parse(h.files.get(SETTINGS_PATH) ?? "{}");
  h.files.set(SETTINGS_PATH, JSON.stringify({ ...current, ...patch }));
}

/** All (event, props) pairs sent to Aptabase so far (props omitted when absent). */
const events = (): unknown[][] => h.trackEvent.mock.calls.map((c) => (c[1] === undefined ? [c[0]] : [c[0], c[1]]));

beforeEach(() => {
  h.files.clear();
  h.handlers.clear();
  vi.resetModules();
});

describe("trackLaunch()", () => {
  it("should emit app_installed and app_opened on the first-ever launch", async () => {
    const { trackLaunch } = await setup();
    trackLaunch();
    expect(events()).toEqual([["app_installed"], ["app_opened"]]);
  });

  it("should emit only app_opened on later launches", async () => {
    const { trackLaunch } = await setup();
    trackLaunch();
    h.trackEvent.mockClear();
    trackLaunch();
    expect(events()).toEqual([["app_opened"]]);
  });

  it("should emit nothing when analytics are opted out", async () => {
    patchSettings({ analyticsEnabled: false });
    const { trackLaunch } = await setup();
    trackLaunch();
    expect(events()).toEqual([]);
  });

  it("should not emit a stale app_installed when an opted-out first run is followed by an opt-in", async () => {
    patchSettings({ analyticsEnabled: false });
    const { trackLaunch } = await setup();
    trackLaunch(); // consumes the first-launch marker silently

    patchSettings({ analyticsEnabled: true });
    trackLaunch();
    expect(events()).toEqual([["app_opened"]]);
  });
});

describe("trackOnce()", () => {
  it("should emit the event with its props exactly once", async () => {
    const { trackOnce } = await setup();
    trackOnce("user_first_message_sent", { model: "anthropic/claude" });
    trackOnce("user_first_message_sent", { model: "anthropic/claude" });
    expect(events()).toEqual([["user_first_message_sent", { model: "anthropic/claude" }]]);
  });

  it("should consume the marker while opted out so a later opt-in never emits it", async () => {
    patchSettings({ analyticsEnabled: false });
    const { trackOnce } = await setup();
    trackOnce("user_first_message_sent");

    patchSettings({ analyticsEnabled: true });
    trackOnce("user_first_message_sent");
    expect(events()).toEqual([]);
  });
});

describe("trackProviderConnected()", () => {
  it("should emit onboarding_completed with the provider and method", async () => {
    const { trackProviderConnected } = await setup();
    trackProviderConnected("anthropic", "oauth");
    expect(events()).toEqual([["onboarding_completed", { provider: "anthropic", method: "oauth" }]]);
  });

  it("should not emit again when a second provider is connected later", async () => {
    const { trackProviderConnected } = await setup();
    trackProviderConnected("anthropic", "oauth");
    trackProviderConnected("openai", "api_key");
    expect(events()).toHaveLength(1);
  });
});

describe("trackAgentFailed()", () => {
  it("should emit agent_failed with the coarse kind", async () => {
    const { trackAgentFailed } = await setup();
    trackAgentFailed("crash");
    expect(events()).toEqual([["agent_failed", { kind: "crash" }]]);
  });

  it("should emit nothing when analytics are opted out", async () => {
    patchSettings({ analyticsEnabled: false });
    const { trackAgentFailed } = await setup();
    trackAgentFailed("spawn");
    expect(events()).toEqual([]);
  });
});

describe("initAnalytics()", () => {
  it("should initialize the SDK without emitting any events", async () => {
    const { initAnalytics } = await setup();
    initAnalytics();
    expect(h.initialize).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([]);
  });
});

describe("trackUpdateDownloaded()", () => {
  it("should emit update_downloaded with the target version", async () => {
    const { trackUpdateDownloaded } = await setup();
    trackUpdateDownloaded("1.2.3");
    expect(events()).toEqual([["update_downloaded", { to_version: "1.2.3" }]]);
  });

  it("should emit nothing when analytics are opted out", async () => {
    patchSettings({ analyticsEnabled: false });
    const { trackUpdateDownloaded } = await setup();
    trackUpdateDownloaded("1.2.3");
    expect(events()).toEqual([]);
  });
});

describe("trackUpdateFailed()", () => {
  it("should emit update_failed with the coarse kind", async () => {
    const { trackUpdateFailed } = await setup();
    trackUpdateFailed("download");
    trackUpdateFailed("check");
    expect(events()).toEqual([
      ["update_failed", { kind: "download" }],
      ["update_failed", { kind: "check" }],
    ]);
  });

  it("should emit nothing when analytics are opted out", async () => {
    patchSettings({ analyticsEnabled: false });
    const { trackUpdateFailed } = await setup();
    trackUpdateFailed("check");
    expect(events()).toEqual([]);
  });
});

describe("trackQuit()", () => {
  it("should emit app_closed, gated on the opt-out", async () => {
    const { trackQuit } = await setup();
    trackQuit();
    expect(events()).toEqual([["app_closed"]]);

    patchSettings({ analyticsEnabled: false });
    h.trackEvent.mockClear();
    trackQuit();
    expect(events()).toEqual([]);
  });
});

describe("trackAnalyticsToggle()", () => {
  it("should emit analytics_disabled even though the setting is already off", async () => {
    patchSettings({ analyticsEnabled: false });
    const { trackAnalyticsToggle } = await setup();
    trackAnalyticsToggle(false);
    expect(events()).toEqual([["analytics_disabled"]]);
  });

  it("should emit analytics_enabled right after an opt-in", async () => {
    const { trackAnalyticsToggle } = await setup();
    trackAnalyticsToggle(true);
    expect(events()).toEqual([["analytics_enabled"]]);
  });
});

describe("skill events", () => {
  it("should emit skill_added with numeric counts", async () => {
    const { trackSkillAdded } = await setup();
    trackSkillAdded(2, 1);
    expect(events()).toEqual([["skill_added", { added_count: 2, skipped_count: 1 }]]);
  });

  it("should emit skill_add_failed with the structural reason", async () => {
    const { trackSkillAddFailed } = await setup();
    trackSkillAddFailed("not_found");
    expect(events()).toEqual([["skill_add_failed", { reason: "not_found" }]]);
  });

  it("should emit skill_removed, skill_enabled, and skill_disabled without props", async () => {
    const { trackSkillRemoved, trackSkillEnabled, trackSkillDisabled } = await setup();
    trackSkillRemoved();
    trackSkillEnabled();
    trackSkillDisabled();
    expect(events()).toEqual([["skill_removed"], ["skill_enabled"], ["skill_disabled"]]);
  });

  it("should emit nothing when analytics are opted out", async () => {
    patchSettings({ analyticsEnabled: false });
    const { trackSkillAdded, trackSkillAddFailed, trackSkillRemoved } = await setup();
    trackSkillAdded(1, 0);
    trackSkillAddFailed("other");
    trackSkillRemoved();
    expect(events()).toEqual([]);
  });
});

describe("analytics_track IPC", () => {
  const invoke = (payload: unknown) => h.handlers.get("analytics_track")?.(null, payload);

  it("should forward a renderer event with its props when analytics are enabled", async () => {
    const { registerAnalyticsIpc } = await setup();
    registerAnalyticsIpc();
    invoke({ event: "attachment_added", props: { kind: "pdf" } });
    expect(events()).toEqual([["attachment_added", { kind: "pdf" }]]);
  });

  it("should drop a renderer event when analytics are opted out", async () => {
    patchSettings({ analyticsEnabled: false });
    const { registerAnalyticsIpc } = await setup();
    registerAnalyticsIpc();
    invoke({ event: "attachment_added" });
    expect(events()).toEqual([]);
  });

  it("should emit a once event at most once across repeated requests", async () => {
    const { registerAnalyticsIpc } = await setup();
    registerAnalyticsIpc();
    invoke({ event: "transaction_first_added", once: true });
    invoke({ event: "transaction_first_added", once: true });
    expect(events()).toEqual([["transaction_first_added"]]);
  });

  it("should consume an opted-out once event so it never emits after an opt-in", async () => {
    patchSettings({ analyticsEnabled: false });
    const { registerAnalyticsIpc } = await setup();
    registerAnalyticsIpc();
    invoke({ event: "transaction_first_added", once: true });

    patchSettings({ analyticsEnabled: true });
    invoke({ event: "transaction_first_added", once: true });
    expect(events()).toEqual([]);
  });

  it("should ignore a payload without an event name", async () => {
    const { registerAnalyticsIpc } = await setup();
    registerAnalyticsIpc();
    invoke(undefined);
    invoke({ props: { kind: "pdf" } });
    expect(events()).toEqual([]);
  });
});
