// The plugin store can change without the user doing anything here: main
// installs the default plugins the first time it reaches the network.

import { useEffect } from "react";
import { pluginsApi } from "@/rpc/api";

/** Run `onChanged` when main reports that the store changed on its own. The
 *  progress lines of an install the user started are not that: the install
 *  dialog shows those itself, and the page reloads when that install returns.
 *
 *  `onChanged` must be stable (useCallback), like every other effect input. */
export function usePluginsStoreChanged(onChanged: () => void): void {
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    pluginsApi
      .onEvent((event) => {
        if (event.type === "changed") onChanged();
      })
      .then((off) => {
        // Unmounted before the subscription landed: drop it right away.
        if (cancelled) off();
        else unsub = off;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [onChanged]);
}
