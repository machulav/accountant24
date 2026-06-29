// Anonymous usage analytics via Aptabase. Tracked entirely from the main process
// (one event per launch, no renderer SDK, no extra IPC channel). Aptabase is
// privacy-first by design: no cookies, no persistent device id, IP only used as
// an ephemeral daily-rotated hash and never stored. Everything here is gated on
// the user's opt-out (Settings → Privacy).

import { ipcMain } from "electron";
import { initialize, trackEvent } from "@aptabase/electron/main";
import { consumeFirstLaunch, isAnalyticsEnabled } from "./settings";

// Not a secret — Aptabase app keys are embedded in the client, like a website
// analytics id. EU region instance.
const APP_KEY = "A-EU-1931893507";

/** Initialize the Aptabase SDK. Safe to call before tracking; emits nothing on
 *  its own. */
export function initAnalytics(): void {
  initialize(APP_KEY);
}

/** Fire launch + (once-ever) install events, gated on the opt-out. */
export function trackLaunch(): void {
  // Always consume the first-launch marker, even when opted out, so an opted-out
  // first run doesn't emit a stale "install" later if the user opts back in.
  const firstLaunch = consumeFirstLaunch();
  if (!isAnalyticsEnabled()) return;
  if (firstLaunch) trackEvent("app_installed");
  trackEvent("app_opened");
}

/** Record the user flipping the analytics opt-out. Called directly (bypassing
 *  the opt-out gate) so the "disabled" event is the last thing we send before
 *  going quiet, and "enabled" is sent right after they opt back in. */
export function trackAnalyticsToggle(enabled: boolean): void {
  trackEvent(enabled ? "analytics_enabled" : "analytics_disabled");
}

/** Register the renderer→main analytics channel. The renderer requests a track;
 *  main is the single place that enforces the opt-out. Callers must pass only
 *  event names + string/number props — NEVER user content (message text, etc.). */
export function registerAnalyticsIpc(): void {
  ipcMain.handle(
    "analytics_track",
    (_e, payload: { event?: string; props?: Record<string, string | number> }) => {
      if (!isAnalyticsEnabled()) return;
      if (payload && typeof payload.event === "string") trackEvent(payload.event, payload.props);
    },
  );
}
