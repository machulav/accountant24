// The bridge exposed by src/preload. Request/response via `invoke`,
// server→client push via `on` (returns an unsubscribe).
export {};

declare global {
  interface Window {
    api: {
      invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
      on(channel: string, cb: (payload: unknown) => void): () => void;
    };
  }
}
