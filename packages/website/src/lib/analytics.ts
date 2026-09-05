// Web analytics via PostHog in cookieless mode: no cookies, no local storage,
// no person profiles, so the page needs no consent banner and stays
// consistent with the product's privacy stance. Unique visitors are counted
// server-side with a daily rotating hash.
import posthog from "posthog-js";

type Client = Pick<typeof posthog, "init" | "capture">;

export const analyticsOptions = {
  api_host: "https://eu.i.posthog.com",
  cookieless_mode: "always",
  person_profiles: "never",
  autocapture: false,
  disable_session_recording: true,
  capture_pageview: true,
  capture_pageleave: true,
  respect_dnt: true,
  // Page views and the CTA clicks are all the site reports. Everything the
  // client can add on its own (heatmaps, dead clicks, web vitals, surveys)
  // costs a phone visitor extra scripts and main-thread time, and the
  // project's remote settings could switch any of it on later: so it is off
  // here, the client loads no script beyond its own, and it never asks the
  // server what to enable.
  capture_heatmaps: false,
  capture_dead_clicks: false,
  capture_performance: false,
  disable_surveys: true,
  disable_external_dependency_loading: true,
  advanced_disable_flags: true,
} as const;

/** Initialize the client. Returns false (and captures nothing) when no key is configured. */
export function initAnalytics(key: string, client: Client = posthog): boolean {
  if (!key) return false;
  client.init(key, analyticsOptions);
  return true;
}

/**
 * Track clicks on CTAs marked with `data-track="<event>"` (and an optional
 * `data-placement`), e.g. `<a data-track="download_clicked" data-placement="hero">`.
 */
export function bindCtaTracking(root: ParentNode, client: Client = posthog): number {
  const ctas = root.querySelectorAll<HTMLElement>("[data-track]");
  for (const cta of ctas) {
    cta.addEventListener("click", () => {
      const event = cta.dataset.track;
      if (!event) return;
      client.capture(event, cta.dataset.placement ? { placement: cta.dataset.placement } : undefined);
    });
  }
  return ctas.length;
}
