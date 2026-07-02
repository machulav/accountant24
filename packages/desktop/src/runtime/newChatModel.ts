// The model a brand-new chat should start with.
//
// react-pi gives a not-yet-created thread an EMPTY runtime (setModel is a no-op,
// no active model), so the composer can't apply a model to it directly — the
// model is fixed when `createThread` runs. This tiny store bridges that: the
// composer records the user's pick here, and `createThread` reads it (falling
// back to the configured default), then clears it so the next new chat starts
// from the default again.

import type { ModelRef } from "../rpc/types";

let pending: ModelRef | undefined;
const listeners = new Set<() => void>();

export const newChatModel = {
  get: (): ModelRef | undefined => pending,
  set: (model: ModelRef | undefined): void => {
    pending = model;
    for (const l of listeners) l();
  },
  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe: (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
