// The local route of the connect step: models that run on this Mac through
// Ollama. What the user can do depends on what is actually running, so the
// panel reports that first and offers the matching next step.

import { useState } from "react";
import { Button } from "@/components/shadcn/button";
import { Spinner } from "@/components/shadcn/spinner";
import { authApi } from "@/rpc/api";
import type { OllamaInfo } from "@/rpc/types";
import { ExternalLink } from "../external-link";
import { ErrorBanner } from "../settings/parts";

const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

export function OllamaConnect({
  info,
  onRecheck,
  onConnected,
}: {
  /** null while the check is in flight. */
  info: OllamaInfo | null;
  onRecheck: () => void;
  onConnected: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.addAllOllama();
      if (result.type === "error") throw new Error(result.message ?? "Failed to connect Ollama");
      await onConnected();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  if (info === null) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> Checking for Ollama
      </p>
    );
  }

  const models = info.models.length;
  return (
    <div className="flex flex-col gap-3">
      {info.running ? (
        models > 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            Ollama is running with {models} {models === 1 ? "model" : "models"} on this Mac. Connecting adds all of
            them.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm text-pretty">
            Ollama is running but has no models yet. Pull one with <code className="font-mono">ollama pull</code>, then
            check again.
          </p>
        )
      ) : (
        <p className="text-muted-foreground text-sm text-pretty">
          Ollama isn't running on this Mac. <ExternalLink href={OLLAMA_DOWNLOAD_URL}>Install Ollama</ExternalLink>,
          start it, then check again.
        </p>
      )}
      {info.running && models > 0 ? (
        <Button onClick={connect} disabled={busy}>
          {busy && <Spinner />}
          {busy ? "Connecting" : "Connect Ollama"}
        </Button>
      ) : (
        <Button variant="outline" onClick={onRecheck}>
          Check again
        </Button>
      )}
      {error && <ErrorBanner message={error} />}
    </div>
  );
}
