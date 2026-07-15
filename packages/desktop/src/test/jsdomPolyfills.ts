// Shared jsdom polyfills for component tests. jsdom omits a handful of layout/
// media APIs that Base UI / assistant-ui components touch on mount; install the
// no-op stubs once per test file (call installJsdomPolyfills() in a beforeAll)
// instead of copy-pasting the preamble. Each stub is `??=`-guarded so it never
// clobbers a real implementation or a test's own override.

export function installJsdomPolyfills(): void {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  Element.prototype.scrollIntoView ??= () => {};
}
