// Anonymous usage analytics via Aptabase. Tracked entirely from the main process
// (one event per launch, no renderer SDK, no extra IPC channel). Aptabase is
// privacy-first by design: no cookies, no persistent device id, IP only used as
// an ephemeral daily-rotated hash and never stored. Everything here is gated on
// the user's opt-out (`analyticsEnabled: false` in <workspace>/app-settings.json).

import { initialize, trackEvent } from "@aptabase/electron/main";
import { ipcMain } from "electron";
import { consumeOnce, isAnalyticsEnabled } from "./settings";

/** Aptabase's own prop types. Booleans carry the flags a plugin event is read
 *  along (official or not) without spending a string on "true"/"false". */
type EventProps = Record<string, string | number | boolean>;

// Not a secret — Aptabase app keys are embedded in the client, like a website
// analytics id. EU region instance.
const APP_KEY = "A-EU-0473586488";

/** Initialize the Aptabase SDK. Safe to call before tracking; emits nothing on
 *  its own. */
export function initAnalytics(): void {
  initialize(APP_KEY);
}

/** The single opt-out gate: every event flows through here (directly or via
 *  trackOnce). Callers fire unconditionally and never check the setting. */
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
export function trackAgentFailed(kind: "crash" | "spawn"): void {
  track("agent_failed", { kind });
}

/** Record a finished update download (it installs on the next quit). The event
 *  itself carries the running (old) app version, so to_version measures both
 *  that the silent pipeline works end-to-end and how fast a release reaches
 *  the fleet. */
export function trackUpdateDownloaded(toVersion: string): void {
  track("update_downloaded", { to_version: toVersion });
}

/** Record the user clicking the "Update available" banner to apply an
 *  already-downloaded update on demand (rather than waiting for the next quit).
 *  to_version is the staged version, mirroring update_downloaded, so the two
 *  form a funnel: downloaded → install_clicked. Best-effort — the app quits
 *  right after, so the send races the teardown (like app_closed). */
export function trackUpdateInstallClicked(toVersion: string): void {
  track("update_install_clicked", { to_version: toVersion });
}

/** Record the silent updater failing. Coarse phase only — error messages can
 *  contain URLs/paths and never leave the machine. "download" points at a
 *  broken release; "check" is mostly offline noise (the caller dedupes both
 *  to one event per session). */
export function trackUpdateFailed(kind: "check" | "download"): void {
  track("update_failed", { kind });
}

/** Who asked for an install: the user picking a plugin out of the marketplace,
 *  or the app installing one of the plugins a new workspace starts with. The
 *  two fail for different reasons and only one of them is ever retried, so
 *  every install event carries which it was. */
export type PluginInstallSource = "marketplace" | "default";

/** Record a plugin install landing in the store — the ending of the
 *  `plugin_install_*` lifecycle that `plugin_install_started` opens and
 *  `plugin_install_failed` is the other half of. Counts and flags only: plugin
 *  names and repos never leave the machine. `official` says it came from the
 *  Accountant24 account, which is the split every plugin number is read
 *  along. */
export function trackPluginInstallSucceeded(source: PluginInstallSource, official: boolean, skillCount: number): void {
  track("plugin_install_succeeded", { source, official, skill_count: skillCount });
}

export type PluginInstallFailReason =
  | "invalid_source"
  | "not_found"
  | "no_plugin"
  | "invalid_plugin"
  | "app_too_old"
  | "collision"
  | "fetch_failed"
  | "other";

/** Record a plugin install that did not land, the other ending to
 *  `plugin_install_succeeded`. Structural reason only — error text can carry
 *  repo names and paths, so it never leaves the machine. A `default` failure
 *  is retried on the next launch, so it counts attempts rather than users. */
export function trackPluginInstallFailed(source: PluginInstallSource, reason: PluginInstallFailReason): void {
  track("plugin_install_failed", { source, reason });
}

/** Record an installed plugin being uninstalled. One event rather than a
 *  `plugin_uninstall_*` lifecycle: uninstalling is a local delete with nothing
 *  to fail on and no confirmation worth measuring separately. Uninstalling is
 *  the only way to turn a plugin off, so this carries the signal a disable
 *  switch would. */
export function trackPluginUninstalled(official: boolean): void {
  track("plugin_uninstalled", { official });
}

export type MarketplaceLoadFailKind = "fetch_failed" | "invalid_index" | "timeout";

/** Record the marketplace index failing to load. Coarse kind only, like the
 *  updater: mostly offline noise, and the messages can carry URLs. */
export function trackMarketplaceLoadFailed(kind: MarketplaceLoadFailKind): void {
  track("marketplace_load_failed", { kind });
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
