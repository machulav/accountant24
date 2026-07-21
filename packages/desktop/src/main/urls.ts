// URL + CSP security policy for the app window. Kept pure and Electron-free so
// it's unit-testable; window.ts wires these decisions into the BrowserWindow.

/** Schemes we're willing to hand to the OS via shell.openExternal. A link in
 *  agent/LLM-rendered markdown is untrusted, so anything outside this set
 *  (file:, javascript:, custom app schemes, smb:, tel:, …) is refused rather
 *  than letting the OS launch a local handler for it. */
const OPENABLE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Whether `url` is safe to open in the system browser. */
export function isOpenableExternalUrl(url: string): boolean {
  try {
    return OPENABLE_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Whether a top-level navigation target is the app itself (same origin as the
 *  window's own URL) — a legitimate in-app navigation or reload. Anything else
 *  is an attempt to replace the app frame with foreign content. */
export function isInternalNavigation(target: string, appUrl: string): boolean {
  try {
    return new URL(target).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

/** The Content-Security-Policy applied to the renderer in packaged builds. The
 *  app serves static file:// content and makes no cross-origin requests from the
 *  renderer (the agent runs over IPC; Ollama is fetched in main), so everything
 *  is locked to 'self'. Inline styles are allowed because the UI libraries inject
 *  them; scripts are 'self' only (no inline/eval). Dev skips this policy so
 *  Vite's HMR keeps working. */
export function rendererCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join("; ");
}
