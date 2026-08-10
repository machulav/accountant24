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

  // This jsdom build ships without Web Storage; back it with a Map so
  // components persisting UI preferences (sidebar width, table columns)
  // work under tests.
  if (!window.localStorage) {
    const backing = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, String(v)),
        removeItem: (k: string) => void backing.delete(k),
        clear: () => backing.clear(),
        key: (i: number) => [...backing.keys()][i] ?? null,
        get length() {
          return backing.size;
        },
      } satisfies Storage,
    });
  }

  // Web Animations API: Base UI's scroll area polls viewport.getAnimations()
  // on a timer; without the stub every grid test run drowns in unhandled
  // TypeErrors after unmount.
  Element.prototype.getAnimations ??= () => [];

  // jsdom Ranges have no layout: Lexical's scroll-into-view reads the
  // selection Range's rect whenever the editor is focused and its content
  // changes (e.g. composer setText in tests).
  Range.prototype.getBoundingClientRect ??= () =>
    ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }) as DOMRect;
}
