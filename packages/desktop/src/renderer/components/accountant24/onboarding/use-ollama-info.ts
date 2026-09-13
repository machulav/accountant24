// Whether Ollama is running on this Mac and what it has, for the local option
// of the connect step. Checked on mount and on demand (the user can start
// Ollama while the wizard is open, then ask again).

import { useCallback, useEffect, useState } from "react";
import { authApi } from "@/rpc/api";
import type { OllamaInfo } from "@/rpc/types";

/** `info` is null while the first check is in flight. A failed check reads as
 *  "not running", which is what it means for the user. */
export function useOllamaInfo(): { info: OllamaInfo | null; recheck: () => void } {
  const [info, setInfo] = useState<OllamaInfo | null>(null);

  const check = useCallback(() => {
    let disposed = false;
    setInfo(null);
    authApi
      .detectOllama()
      .then((next) => {
        if (!disposed) setInfo(next);
      })
      .catch(() => {
        if (!disposed) setInfo({ type: "ollama", running: false, models: [] });
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => check(), [check]);

  return { info, recheck: check };
}
