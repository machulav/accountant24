// Login screen: connect an LLM provider before the chat can start.
//   - API key: paste a key for any provider.
//   - OAuth: sign in to a subscription (Claude Pro/Max, ChatGPT) via the browser.
//   - Local: detect Ollama and register a model (no key needed).

import { useEffect, useState } from "react";
import { authApi } from "../rpc/api";
import type { AuthProviders, OllamaInfo } from "../rpc/types";
import { useOAuthLogin } from "./auth/useOAuthLogin";

type Mode = "menu" | "apikey" | "oauth" | "ollama";

export function Login({ onDone }: { onDone: () => void }) {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [mode, setMode] = useState<Mode>("menu");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authApi
      .providers()
      .then(setProviders)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <div className="brand-mark">₳</div>
          <h1>Accountant24</h1>
          <p className="muted">Connect a model to get started.</p>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {mode === "menu" && (
          <div className="login-menu">
            <button type="button" className="primary" onClick={() => setMode("oauth")}>
              Sign in with a subscription
              <span className="sub">Claude Pro/Max · ChatGPT</span>
            </button>
            <button type="button" onClick={() => setMode("apikey")}>
              Use an API key
              <span className="sub">Anthropic · OpenAI · Google · others</span>
            </button>
            <button type="button" onClick={() => setMode("ollama")}>
              Run locally with Ollama
              <span className="sub">Fully offline · no key</span>
            </button>
          </div>
        )}

        {mode === "apikey" && providers && (
          <ApiKeyForm providers={providers} onBack={() => setMode("menu")} onDone={onDone} />
        )}
        {mode === "oauth" && providers && (
          <OAuthForm providers={providers} onBack={() => setMode("menu")} onDone={onDone} />
        )}
        {mode === "ollama" && <OllamaForm onBack={() => setMode("menu")} onDone={onDone} />}
      </div>
    </div>
  );
}

function ApiKeyForm({
  providers,
  onBack,
  onDone,
}: {
  providers: AuthProviders;
  onBack: () => void;
  onDone: () => void;
}) {
  const choices = providers.all.filter((p) => !p.oauth || p.provider === "anthropic" || p.provider === "openai");
  const [provider, setProvider] = useState(choices[0]?.provider ?? "anthropic");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    // The busy guard also covers Enter on the input, which (unlike the Connect
    // button) isn't disabled while a save is in flight.
    if (busy || !key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.setKey(provider, key.trim());
      if (result.type === "error") throw new Error(result.message ?? "Failed to save key");
      onDone();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="login-form">
      <label>
        Provider
        <select value={provider} onChange={(e) => setProvider(e.currentTarget.value)}>
          {choices.map((p) => (
            <option key={p.provider} value={p.provider}>
              {p.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        API key
        <input
          type="password"
          value={key}
          placeholder="sk-..."
          onChange={(e) => setKey(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>
      {error && <div className="error-banner">{error}</div>}
      <div className="row-buttons">
        <button type="button" onClick={onBack} disabled={busy}>
          Back
        </button>
        <button type="button" className="primary" onClick={submit} disabled={busy || !key.trim()}>
          {busy ? "Saving…" : "Connect"}
        </button>
      </div>
    </div>
  );
}

function OAuthForm({
  providers,
  onBack,
  onDone,
}: {
  providers: AuthProviders;
  onBack: () => void;
  onDone: () => void;
}) {
  const { active, log, request, error, start, respond, cancel } = useOAuthLogin(onDone);
  const [answer, setAnswer] = useState("");

  const startLogin = (providerId: string) => start(providerId);

  const answerRequest = (value: string | null) => {
    respond(value);
    setAnswer("");
  };

  if (!active) {
    return (
      <div className="login-form">
        {providers.oauth.map((p) => (
          <button type="button" key={p.id} className="primary" onClick={() => startLogin(p.id)}>
            Sign in — {p.name}
          </button>
        ))}
        {error && <div className="error-banner">{error}</div>}
        <div className="row-buttons">
          <button type="button" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-form">
      <div className="oauth-log">
        {log.length === 0 ? <p className="muted">Starting sign-in…</p> : log.map((line, i) => <p key={i}>{line}</p>)}
      </div>

      {request && request.kind === "select" && (
        <div className="oauth-request">
          <p>{request.message}</p>
          {request.options?.map((opt) => (
            <button type="button" key={opt.id} onClick={() => answerRequest(opt.id)}>
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {request && (request.kind === "prompt" || request.kind === "manual_code") && (
        <div className="oauth-request">
          <p>{request.message}</p>
          <input
            value={answer}
            placeholder={request.placeholder}
            onChange={(e) => setAnswer(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && answerRequest(answer)}
          />
          <button type="button" className="primary" onClick={() => answerRequest(answer)}>
            Submit
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      <div className="row-buttons">
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function OllamaForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [info, setInfo] = useState<OllamaInfo | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authApi
      .detectOllama()
      .then((i) => {
        setInfo(i);
        setSelected(i.models[0] ?? "");
      })
      .catch((e) => setError(String(e)));
  }, []);

  const connect = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.addOllama(selected);
      if (result.type === "error") throw new Error(result.message ?? "Failed to register model");
      onDone();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="login-form">
      {!info && <p className="muted">Looking for Ollama…</p>}
      {info && !info.running && (
        <div className="error-banner">
          Ollama isn’t running. Install it from ollama.com, then pull a model and try again.
        </div>
      )}
      {info?.running && info.models.length === 0 && (
        <div className="error-banner">Ollama is running but has no models. Pull one with `ollama pull`.</div>
      )}
      {info?.running && info.models.length > 0 && (
        <label>
          Model
          <select value={selected} onChange={(e) => setSelected(e.currentTarget.value)}>
            {info.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <div className="error-banner">{error}</div>}
      <div className="row-buttons">
        <button type="button" onClick={onBack} disabled={busy}>
          Back
        </button>
        <button type="button" className="primary" onClick={connect} disabled={busy || !selected}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}
