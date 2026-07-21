import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// window.ts creates the single app window and wires its security policy:
// hardened webPreferences, an external-only window-open handler, an
// off-origin-blocking will-navigate guard, and a CSP for packaged builds.
// Electron (BrowserWindow + shell) is the faked boundary; the real ./urls
// helpers make the actual open/navigate/CSP decisions (they're pure and
// separately tested), so this suite verifies the wiring, not a re-mock of them.

type Fn = (...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  ctorOpts: undefined as Record<string, unknown> | undefined,
  show: vi.fn(),
  once: new Map<string, Fn>(),
  on: new Map<string, Fn>(),
  windowOpenHandler: undefined as ((d: { url: string }) => { action: string }) | undefined,
  onHeadersReceived: undefined as ((details: unknown, cb: Fn) => void) | undefined,
  currentUrl: "app://index/",
  loadURL: vi.fn(() => Promise.resolve()),
  loadFile: vi.fn(() => Promise.resolve()),
  openExternal: vi.fn(() => Promise.resolve()),
}));

class FakeBrowserWindow {
  webContents = {
    setWindowOpenHandler: (fn: (d: { url: string }) => { action: string }) => {
      h.windowOpenHandler = fn;
    },
    on: (evt: string, fn: Fn) => {
      h.on.set(evt, fn);
    },
    getURL: () => h.currentUrl,
    session: {
      webRequest: {
        onHeadersReceived: (fn: (details: unknown, cb: Fn) => void) => {
          h.onHeadersReceived = fn;
        },
      },
    },
  };
  loadURL = h.loadURL;
  loadFile = h.loadFile;
  show = h.show;
  once = (evt: string, fn: Fn) => {
    h.once.set(evt, fn);
  };
  constructor(opts: Record<string, unknown>) {
    h.ctorOpts = opts;
  }
}

vi.mock("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  shell: { openExternal: h.openExternal },
}));

let prevRendererUrl: string | undefined;

async function createWindow() {
  const { createWindow } = await import("../window");
  return createWindow();
}

beforeEach(() => {
  prevRendererUrl = process.env.ELECTRON_RENDERER_URL;
  h.ctorOpts = undefined;
  h.once.clear();
  h.on.clear();
  h.windowOpenHandler = undefined;
  h.onHeadersReceived = undefined;
  h.currentUrl = "app://index/";
  h.show.mockClear();
  h.loadURL.mockClear();
  h.loadFile.mockClear();
  h.openExternal.mockClear();
  vi.resetModules();
});

afterEach(() => {
  if (prevRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL;
  else process.env.ELECTRON_RENDERER_URL = prevRendererUrl;
});

describe("createWindow()", () => {
  describe("window preferences", () => {
    it("should harden webPreferences (context isolation on, node integration off, sandbox off for ESM preload)", async () => {
      process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
      await createWindow();
      const web = h.ctorOpts?.webPreferences as Record<string, unknown>;
      expect(web.contextIsolation).toBe(true);
      expect(web.nodeIntegration).toBe(false);
      expect(web.sandbox).toBe(false);
      expect(String(web.preload)).toMatch(/preload[/\\]index\.mjs$/);
    });

    it("should use the documented size, minimums, and inset title bar and start hidden", async () => {
      process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
      await createWindow();
      expect(h.ctorOpts).toMatchObject({
        width: 980,
        height: 720,
        minWidth: 560,
        minHeight: 480,
        show: false,
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 14, y: 14 },
      });
    });
  });

  describe("ready-to-show", () => {
    it("should show the window only once it is ready-to-show", async () => {
      process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
      await createWindow();
      expect(h.show).not.toHaveBeenCalled();
      h.once.get("ready-to-show")?.();
      expect(h.show).toHaveBeenCalledTimes(1);
    });
  });

  describe("window-open handler", () => {
    it("should deny every popup and open an http(s) target in the system browser instead", async () => {
      process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
      await createWindow();
      const result = h.windowOpenHandler?.({ url: "https://example.com/docs" });
      expect(result).toEqual({ action: "deny" });
      expect(h.openExternal).toHaveBeenCalledWith("https://example.com/docs");
    });

    it("should deny and NOT hand a non-openable scheme to the OS", async () => {
      process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
      await createWindow();
      const result = h.windowOpenHandler?.({ url: "file:///etc/passwd" });
      expect(result).toEqual({ action: "deny" });
      expect(h.openExternal).not.toHaveBeenCalled();
    });
  });

  describe("will-navigate guard", () => {
    it("should allow a same-origin navigation without blocking or opening it externally", async () => {
      process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
      await createWindow();
      h.currentUrl = "https://app.local/home";
      const event = { preventDefault: vi.fn() };
      h.on.get("will-navigate")?.(event, "https://app.local/settings");
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(h.openExternal).not.toHaveBeenCalled();
    });

    it("should block an off-origin http(s) navigation and open it externally instead", async () => {
      process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
      await createWindow();
      h.currentUrl = "https://app.local/home";
      const event = { preventDefault: vi.fn() };
      h.on.get("will-navigate")?.(event, "https://evil.example/phish");
      expect(event.preventDefault).toHaveBeenCalled();
      expect(h.openExternal).toHaveBeenCalledWith("https://evil.example/phish");
    });

    it("should block an off-origin non-openable navigation without handing it to the OS", async () => {
      process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
      await createWindow();
      h.currentUrl = "https://app.local/home";
      const event = { preventDefault: vi.fn() };
      h.on.get("will-navigate")?.(event, "file:///etc/passwd");
      expect(event.preventDefault).toHaveBeenCalled();
      expect(h.openExternal).not.toHaveBeenCalled();
    });
  });

  describe("content loading", () => {
    it("should load the dev renderer URL and apply no CSP when ELECTRON_RENDERER_URL is set", async () => {
      process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
      await createWindow();
      expect(h.loadURL).toHaveBeenCalledWith("http://localhost:5173/");
      expect(h.loadFile).not.toHaveBeenCalled();
      expect(h.onHeadersReceived).toBeUndefined();
    });

    it("should load the packaged index.html and enforce a locked-down CSP when no dev URL is set", async () => {
      delete process.env.ELECTRON_RENDERER_URL;
      await createWindow();
      expect(h.loadFile).toHaveBeenCalledTimes(1);
      expect(String((h.loadFile.mock.calls[0] as unknown[])[0])).toMatch(/renderer[/\\]index\.html$/);
      expect(h.loadURL).not.toHaveBeenCalled();
      expect(h.onHeadersReceived).toBeTypeOf("function");

      const captured: { responseHeaders?: Record<string, string[]> } = {};
      h.onHeadersReceived?.({ responseHeaders: { "X-Existing": ["1"] } }, (r: unknown) => {
        Object.assign(captured, r);
      });
      const csp = captured.responseHeaders?.["Content-Security-Policy"]?.[0] ?? "";
      // Spec: the packaged renderer is locked to its own origin.
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
      // Pre-existing headers are preserved, not dropped.
      expect(captured.responseHeaders?.["X-Existing"]).toEqual(["1"]);
    });
  });
});
