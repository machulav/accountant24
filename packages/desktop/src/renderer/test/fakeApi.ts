// Fake `window.api` bridge for renderer integration tests.
//
// The whole renderer reaches the main process through the preload-injected
// `window.api` (see src/preload/index.ts), which `src/renderer/rpc/api.ts` wraps in
// typed helpers. A test can therefore exercise real UI + real rpc wiring by
// installing a fake bridge here instead of mocking every `@/rpc/api` export.
//
// Two moving parts mirror the real preload contract:
//   - invoke(channel, payload) -> Promise  (request/response)
//   - on(channel, cb) -> unsubscribe        (main->renderer push)
//
// IMPORTANT: `src/rpc/api.ts` captures `window.api` at module-load time
// (`const api = window.api`). Install the fake BEFORE that module (and anything
// importing it) is evaluated. In a test file, do that from `vi.hoisted(...)`,
// which runs before the file's imports:
//
//   const bridge = vi.hoisted(() => require("@/test/fakeApi").installFakeApi());
//   // ...then in a test: bridge.setHandler("auth_status", () => status);
//   //                    bridge.emit("agent-event", JSON.stringify(evt));

export type InvokeHandler = (payload?: unknown) => unknown | Promise<unknown>;

export interface FakeApi {
  /** The object assigned to `window.api`. */
  readonly api: {
    invoke(channel: string, payload?: unknown): Promise<unknown>;
    on(channel: string, cb: (payload: unknown) => void): () => void;
  };
  /** Register/replace the responder for an invoke channel. */
  setHandler(channel: string, handler: InvokeHandler): void;
  /** Push an event to all `on(channel)` subscribers (main->renderer). */
  emit(channel: string, payload: unknown): void;
  /** Ordered log of every invoke, for asserting exact IPC calls. */
  readonly calls: { channel: string; payload: unknown }[];
  /** Convenience: all payloads sent to one channel, in order. */
  callsFor(channel: string): unknown[];
  /** Number of live subscribers on an event channel (leak checks). */
  listenerCount(channel: string): number;
  /** Reset handlers, listeners, and the call log between tests. */
  reset(): void;
}

export function createFakeApi(): FakeApi {
  const handlers = new Map<string, InvokeHandler>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const calls: { channel: string; payload: unknown }[] = [];

  const fake: FakeApi = {
    api: {
      async invoke(channel, payload) {
        calls.push({ channel, payload });
        const handler = handlers.get(channel);
        if (!handler) throw new Error(`fakeApi: no handler for invoke channel "${channel}"`);
        return await handler(payload);
      },
      on(channel, cb) {
        let set = listeners.get(channel);
        if (!set) {
          set = new Set();
          listeners.set(channel, set);
        }
        set.add(cb);
        return () => set?.delete(cb);
      },
    },
    setHandler(channel, handler) {
      handlers.set(channel, handler);
    },
    emit(channel, payload) {
      for (const cb of listeners.get(channel) ?? []) cb(payload);
    },
    calls,
    callsFor(channel) {
      return calls.filter((c) => c.channel === channel).map((c) => c.payload);
    },
    listenerCount(channel) {
      return listeners.get(channel)?.size ?? 0;
    },
    reset() {
      handlers.clear();
      listeners.clear();
      calls.length = 0;
    },
  };

  return fake;
}

/** Create a fake bridge and assign it to `window.api`. Returns the handle. */
export function installFakeApi(): FakeApi {
  const fake = createFakeApi();
  (globalThis as { window?: { api?: unknown } }).window ??= {} as never;
  (window as unknown as { api: unknown }).api = fake.api;
  return fake;
}
