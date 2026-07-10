// The version of a downloaded-and-staged update, or null when none is pending.
// Seeded from update_pending on mount (the "update-downloaded" push may have
// fired before we subscribed) and kept fresh by that push afterwards. Drives the
// sidebar's "Relaunch to update" banner. In dev / rc builds this stays null.

import { useEffect, useState } from "react";
import { updateApi } from "../rpc/api";

/** `null` when no update is staged; the pending version string otherwise. */
export function useUpdateStatus(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    // The push is the fresher source: if it lands while pending() is still in
    // flight, don't let the (older) pending() result overwrite it. So seed only
    // when nothing is set yet, and always let a push win outright.
    updateApi
      .pending()
      .then((v) => {
        if (!disposed) setVersion((cur) => cur ?? v);
      })
      .catch(() => undefined);
    const unsubscribe = updateApi.onDownloaded((v) => setVersion(v));
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return version;
}
