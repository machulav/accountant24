// Stale-while-revalidate fetch of the main-page finance overview. The overview
// only exists in the empty-thread view: it unmounts when a chat starts (the
// only way ledger data changes) and remounts on "New chat", so fetch-on-mount
// keeps it fresh. A module-level cache renders the previous result instantly on
// remount while a background refetch replaces it.

import { useEffect, useState } from "react";
import { ledgerApi } from "../rpc/api";
import type { DashboardData } from "../rpc/types";

let cache: DashboardData | null = null;

export function useDashboardData(): { data: DashboardData | null; loading: boolean } {
  const [data, setData] = useState<DashboardData | null>(cache);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    let disposed = false;
    ledgerApi
      .dashboard()
      .then((fresh) => {
        cache = fresh;
        if (!disposed) {
          setData(fresh);
          setLoading(false);
        }
      })
      .catch(() => {
        // Keep any cached data; with no cache the overview stays hidden.
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  return { data, loading };
}
