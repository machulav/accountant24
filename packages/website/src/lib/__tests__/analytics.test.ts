// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { analyticsOptions, bindCtaTracking, initAnalytics } from "../analytics";

function fakeClient() {
  return { init: vi.fn(), capture: vi.fn() };
}

describe("initAnalytics()", () => {
  it("should not initialize the client and return false when no key is configured", () => {
    const client = fakeClient();
    expect(initAnalytics("", client)).toBe(false);
    expect(client.init).not.toHaveBeenCalled();
  });

  it("should initialize the client with the key and the cookieless options", () => {
    const client = fakeClient();
    expect(initAnalytics("phc_test", client)).toBe(true);
    expect(client.init).toHaveBeenCalledWith("phc_test", analyticsOptions);
  });

  it("should use cookieless mode without person profiles, recordings or autocapture against the EU host", () => {
    expect(analyticsOptions).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      cookieless_mode: "always",
      person_profiles: "never",
      autocapture: false,
      disable_session_recording: true,
      capture_pageview: true,
      capture_pageleave: true,
      respect_dnt: true,
    });
  });

  it("should report page views and CTA clicks only: no heatmaps, dead clicks, web vitals or surveys", () => {
    expect(analyticsOptions).toMatchObject({
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_performance: false,
      disable_surveys: true,
    });
  });

  it("should load no script beyond its own and never ask the server what to enable", () => {
    expect(analyticsOptions).toMatchObject({
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
    });
  });

  it("should set nothing beyond the documented options", () => {
    expect(Object.keys(analyticsOptions).sort()).toEqual(
      [
        "advanced_disable_flags",
        "api_host",
        "autocapture",
        "capture_dead_clicks",
        "capture_heatmaps",
        "capture_pageleave",
        "capture_pageview",
        "capture_performance",
        "cookieless_mode",
        "disable_external_dependency_loading",
        "disable_session_recording",
        "disable_surveys",
        "person_profiles",
        "respect_dnt",
      ].sort(),
    );
  });
});

describe("bindCtaTracking()", () => {
  it("should capture the event with its placement when a marked CTA is clicked", () => {
    document.body.innerHTML = `<a href="#" data-track="download_clicked" data-placement="hero">Download</a>`;
    const client = fakeClient();
    bindCtaTracking(document, client);
    document.querySelector("a")?.click();
    expect(client.capture).toHaveBeenCalledWith("download_clicked", { placement: "hero" });
  });

  it("should capture the event without properties when the CTA has no placement", () => {
    document.body.innerHTML = `<a href="#" data-track="github_clicked">GitHub</a>`;
    const client = fakeClient();
    bindCtaTracking(document, client);
    document.querySelector("a")?.click();
    expect(client.capture).toHaveBeenCalledWith("github_clicked", undefined);
  });

  it("should return how many CTAs were bound and ignore unmarked links", () => {
    document.body.innerHTML = `
      <a href="#" data-track="a">A</a>
      <a href="#" data-track="b" data-placement="footer">B</a>
      <a href="#">plain</a>`;
    const client = fakeClient();
    expect(bindCtaTracking(document, client)).toBe(2);
    for (const link of document.querySelectorAll("a")) link.click();
    expect(client.capture).toHaveBeenCalledTimes(2);
  });

  it("should not capture anything for a CTA whose event name is empty", () => {
    document.body.innerHTML = `<a href="#" data-track="">empty</a>`;
    const client = fakeClient();
    expect(bindCtaTracking(document, client)).toBe(1);
    document.querySelector("a")?.click();
    expect(client.capture).not.toHaveBeenCalled();
  });

  it("should capture once per click, on every click", () => {
    document.body.innerHTML = `<a href="#" data-track="docs_clicked">Docs</a>`;
    const client = fakeClient();
    bindCtaTracking(document, client);
    const link = document.querySelector("a") as HTMLAnchorElement;
    link.click();
    link.click();
    expect(client.capture).toHaveBeenCalledTimes(2);
  });
});
