// Anonymous usage analytics via Aptabase. Tracked entirely from the main process
// (one event per launch, no renderer SDK, no extra IPC channel). Aptabase is
// privacy-first by design: no cookies, no persistent device id, IP only used as
// an ephemeral daily-rotated hash and never stored. Everything here is gated on
// the user's opt-out (Settings → Privacy).

import { initialize, trackEvent } from "@aptabase/electron/main";
import { ipcMain } from "electron";
import { consumeOnce, isAnalyticsEnabled } from "./settings";

type EventProps = Record<string, string | number>;

// Not a secret — Aptabase app keys are embedded in the client, like a website
// analytics id. EU region instance.
const APP_KEY = "A-EU-0473586488";

/** Initialize the Aptabase SDK. Safe to call before tracking; emits nothing on
 *  its own. */
export function initAnalytics(): void {
  initialize(APP_KEY);
}

/** The single opt-out gate: every event flows through here (directly or via
 *  trackOnce). Callers fire unconditionally and never check the setting —
 *  the only exception is trackAnalyticsToggle (see its note). */
function track(event: string, props?: EventProps): void {
  if (!isAnalyticsEnabled()) return;
  trackEvent(event, props);
}

/** Fire a one-time milestone event, emitted at most once per install. The
 *  marker is consumed even when opted out, so an opted-out milestone doesn't
 *  emit as a stale event after a later opt-in. */
export function trackOnce(event: string, props?: EventProps): void {
  if (!consumeOnce(event)) return;
  track(event, props);
}

/** Fire launch + (once-ever) install events. */
export function trackLaunch(): void {
  trackOnce("app_installed");
  track("app_opened");
}

/** Fire the app-quit event. Best-effort: the SDK sends this over the network as
 *  the process is tearing down, so it may not always land. */
export function trackQuit(): void {
  track("app_closed");
}

/** Record a provider becoming usable. The first-ever connect is the moment
 *  onboarding actually succeeded (App swaps to the chat once a model exists). */
export function trackProviderConnected(provider: string, method: "oauth" | "api_key" | "ollama"): void {
  trackOnce("onboarding_completed", { provider, method });
}

/** Record the agent child failing (crash or spawn error). Coarse kind only —
 *  stderr/messages never leave the machine. */
export function trackAgentError(kind: "crash" | "spawn"): void {
  track("agent_error", { kind });
}

/** Record a finished update download (it installs on the next quit). The event
 *  itself carries the running (old) app version, so to_version measures both
 *  that the silent pipeline works end-to-end and how fast a release reaches
 *  the fleet. */
export function trackUpdateDownloaded(toVersion: string): void {
  track("update_downloaded", { to_version: toVersion });
}

/** Record the silent updater failing. Coarse phase only — error messages can
 *  contain URLs/paths and never leave the machine. "download" points at a
 *  broken release; "check" is mostly offline noise (the caller dedupes both
 *  to one event per session). */
export function trackUpdateError(kind: "check" | "download"): void {
  track("update_error", { kind });
}

/** Record the user flipping the analytics opt-out. The one caller that bypasses
 *  the gate: "disabled" must be the last thing we send before going quiet (the
 *  setting has already flipped to off when this fires), and "enabled" is sent
 *  right after they opt back in. */
export function trackAnalyticsToggle(enabled: boolean): void {
  trackEvent(enabled ? "analytics_enabled" : "analytics_disabled");
}

/** Register the renderer→main analytics channel. The renderer fires
 *  unconditionally; main's gate decides. Callers must pass only event names +
 *  string/number props — NEVER user content (message text, etc.). */
export function registerAnalyticsIpc(): void {
  ipcMain.handle("analytics_track", (_e, payload: { event?: string; props?: EventProps; once?: boolean }) => {
    if (!payload || typeof payload.event !== "string") return;
    if (payload.once) trackOnce(payload.event, payload.props);
    else track(payload.event, payload.props);
  });
}
