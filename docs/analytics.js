// Web analytics via PostHog, same cookieless setup as the landing page
// (packages/website/src/lib/analytics.ts): no cookies, no storage, no person
// profiles, no recordings, so no consent banner. Mintlify loads any .js file in
// the content directory on every page. Empty key = analytics off.
(function () {
  var KEY = "phc_uW2qYr3JBuxXYxMgohfFuntxGVazUhLExQQy6uy6bcoD";
  if (!KEY || navigator.doNotTrack === "1") return;

  var script = document.createElement("script");
  script.async = true;
  script.src = "https://eu-assets.i.posthog.com/static/array.js";
  script.onload = function () {
    if (!window.posthog) return;
    window.posthog.init(KEY, {
      api_host: "https://eu.i.posthog.com",
      cookieless_mode: "always",
      person_profiles: "never",
      autocapture: false,
      disable_session_recording: true,
      capture_pageview: "history_change",
      capture_pageleave: true,
      respect_dnt: true,
    });
  };
  document.head.appendChild(script);
})();
