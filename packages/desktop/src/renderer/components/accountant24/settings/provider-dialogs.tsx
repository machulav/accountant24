// The two ways to connect a provider: paste an API key, or follow an
// interactive OAuth sign-in (browser handoff, device codes, mid-flow prompts).
// Each flow is a hook (state + the call to main) plus a view (the fields), so
// Settings can host them in a dialog and onboarding can host them inline on the
// page, both rendering exactly the same thing.

import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useRef, useState } from "react";
import { AppDialogHeader } from "@/components/accountant24/app-dialog-header";
import { ExternalLink } from "@/components/accountant24/external-link";
import { Button } from "@/components/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogOverlay,
  DialogPortal,
} from "@/components/shadcn/dialog";
import { Field, FieldLabel } from "@/components/shadcn/field";
import { Input } from "@/components/shadcn/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/shadcn/input-group";
import { Spinner } from "@/components/shadcn/spinner";
import type { OAuthLogin, OAuthPendingRequest } from "@/hooks/use-oauth-login";
import { authApi } from "@/rpc/api";
import type { AuthProviderRow } from "@/rpc/types";
import { ErrorBanner } from "./parts";

/** Base UI skips a nested dialog's backdrop by default, so these dialogs
 *  wouldn't dim/blur the Settings surface behind them the way Settings itself
 *  dims the app. Force one so they do. */
function NestedDialogBackdrop() {
  return (
    <DialogPortal>
      <DialogOverlay forceRender />
    </DialogPortal>
  );
}

/** The last non-null provider. The dialogs signal "closed" with a null
 *  provider, but the content must stay in the tree while the close transition
 *  plays out — unmounting it immediately would strand the dialog mid-close
 *  (and leave the forced backdrop up forever). */
function useLastProvider(provider: AuthProviderRow | null): AuthProviderRow | null {
  const last = useRef(provider);
  if (provider) last.current = provider;
  return provider ?? last.current;
}

// ---- API key ------------------------------------------------------------

export function ApiKeyDialog({
  provider,
  onClose,
  onSaved,
}: {
  /** The provider being connected, or null when the dialog is closed. */
  provider: AuthProviderRow | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const shown = useLastProvider(provider);
  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && onClose()}>
      <NestedDialogBackdrop />
      {/* Keyed so the form resets when the dialog reopens for another provider. */}
      {shown && <ApiKeyDialogBody key={shown.provider} provider={shown} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

export interface ApiKeyForm {
  key: string;
  setKey: (value: string) => void;
  show: boolean;
  toggleShow: () => void;
  busy: boolean;
  error: string | null;
  canSubmit: boolean;
  submit: () => Promise<void>;
}

/** The API key flow: what the user typed, and storing it. Mount one per
 *  provider (key the host component by provider id) so switching providers
 *  starts from an empty field. `onSaved` runs after the key is stored. */
export function useApiKeyForm(providerId: string, onSaved: () => void | Promise<void>): ApiKeyForm {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    // The busy guard also covers Enter on the input, which (unlike the Connect
    // button) isn't disabled while a save is in flight.
    if (busy || !key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.setKey(providerId, key.trim());
      if (result.type === "error") throw new Error(result.message ?? "Failed to save key");
      await onSaved();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return {
    key,
    setKey,
    show,
    toggleShow: () => setShow((s) => !s),
    busy,
    error,
    canSubmit: !busy && key.trim().length > 0,
    submit,
  };
}

/** The key input itself: masked by default, with a reveal toggle, Enter to
 *  submit, and the failure underneath. */
export function ApiKeyField({ form, autoFocus }: { form: ApiKeyForm; autoFocus?: boolean }) {
  const { key, setKey, show, toggleShow, busy, error, submit } = form;
  return (
    <Field>
      <FieldLabel htmlFor="provider-api-key">API Key</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id="provider-api-key"
          type={show ? "text" : "password"}
          value={key}
          placeholder="Paste your API key"
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => setKey(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label={show ? "Hide API key" : "Show API key"} onClick={toggleShow}>
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {error && <ErrorBanner message={error} />}
    </Field>
  );
}

/** The submit button for the key field. */
export function ApiKeyConnectButton({ form, className }: { form: ApiKeyForm; className?: string }) {
  return (
    <Button onClick={form.submit} disabled={!form.canSubmit} className={className}>
      {form.busy && <Spinner />}
      {form.busy ? "Connecting" : "Connect"}
    </Button>
  );
}

function ApiKeyDialogBody({
  provider,
  onClose,
  onSaved,
}: {
  provider: AuthProviderRow;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const form = useApiKeyForm(provider.provider, onSaved);
  return (
    <DialogContent showCloseButton={false} className="flex flex-col gap-0 overflow-hidden p-0">
      <AppDialogHeader title={`Connect ${provider.displayName}`} />
      <div className="flex flex-col gap-6 p-6">
        <DialogDescription>
          Paste an API key from your {provider.displayName} account. It will be stored locally on this device.
        </DialogDescription>
        <ApiKeyField form={form} autoFocus />
      </div>
      <DialogFooter className="border-t px-6 py-4">
        <Button variant="outline" onClick={onClose} disabled={form.busy}>
          Cancel
        </Button>
        <ApiKeyConnectButton form={form} />
      </DialogFooter>
    </DialogContent>
  );
}

// ---- OAuth sign-in ------------------------------------------------------

export function OAuthSignInDialog({
  provider,
  oauth,
}: {
  /** The provider signing in (or whose sign-in failed), or null when closed. */
  provider: AuthProviderRow | null;
  oauth: OAuthLogin;
}) {
  // After a failure `active` is already null, so closing must only clear the
  // error; cancelling then would abort nothing and needlessly poke the helper.
  const close = () => (oauth.active ? oauth.cancel() : oauth.dismissError());

  const shown = useLastProvider(provider);
  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && close()}>
      <NestedDialogBackdrop />
      {shown && <OAuthSignInBody key={shown.provider} provider={shown} oauth={oauth} onClose={close} />}
    </Dialog>
  );
}

export interface OAuthSignInView {
  /** Waiting on the outside world, as opposed to on the user. */
  waiting: boolean;
  lines: string[];
  /** The pending question, when the flow is asking for typed input. */
  textRequest: OAuthPendingRequest | null;
  /** The label for that question, reworded where pi's wording is unclear. */
  label: string | undefined;
  answer: string;
  setAnswer: (value: string) => void;
  canSubmit: boolean;
  submit: () => void;
  choose: (optionId: string) => void;
}

/** The presentation state of a sign-in: what to show, and what the user can
 *  answer. The flow itself lives in the OAuthLogin passed in. */
export function useOAuthSignInView(providerId: string, oauth: OAuthLogin): OAuthSignInView {
  const [answer, setAnswer] = useState("");
  const respond = (value: string | null) => {
    oauth.respond(value);
    setAnswer("");
  };

  // Show a spinner on the last progress line only while we're actually waiting
  // on the outside world — not when the flow is asking the user something, has
  // handed off via a device code, or is over.
  const waiting = oauth.active !== null && !oauth.request && !oauth.deviceCode && !oauth.error;
  const lines = oauth.log.length > 0 ? oauth.log : waiting ? ["Starting sign-in…"] : [];

  const textRequest = oauth.request?.kind === "prompt" || oauth.request?.kind === "manual_code" ? oauth.request : null;
  // A blank answer can be a valid response ("blank for the default").
  const canSubmit = textRequest !== null && (Boolean(textRequest.allowEmpty) || answer.trim().length > 0);

  // pi's Copilot flow opens with a free-text prompt where blank means
  // github.com. Reword it so the common case (just hit Continue) is obvious.
  const isCopilotDomainPrompt =
    providerId === "github-copilot" && textRequest?.kind === "prompt" && textRequest.allowEmpty === true;
  // A full URL works too (pi normalizes either to a hostname), but "domain"
  // plus the placeholder is the clearer ask.
  const label = isCopilotDomainPrompt ? "GitHub Enterprise domain (optional)" : textRequest?.message;

  return {
    waiting,
    lines,
    textRequest,
    label,
    answer,
    setAnswer,
    canSubmit,
    submit: () => respond(answer),
    choose: (optionId: string) => respond(optionId),
  };
}

/** Everything a running sign-in shows: progress, a device code, the question
 *  it is asking, and any failure. The host supplies the surrounding chrome and
 *  the Cancel/Continue buttons. */
export function OAuthSignInProgress({ oauth, view }: { oauth: OAuthLogin; view: OAuthSignInView }) {
  const { waiting, lines, textRequest, label, answer, setAnswer, canSubmit, submit, choose } = view;
  return (
    <div className="flex flex-col gap-4">
      {lines.length > 0 && (
        <div className="flex flex-col gap-2">
          {lines.map((line, i) => {
            const current = waiting && i === lines.length - 1;
            return (
              <div key={i} className="flex items-start gap-2 text-sm">
                {current ? (
                  <Spinner className="text-muted-foreground mt-0.5 shrink-0" />
                ) : (
                  <CheckIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                )}
                <span className={current ? undefined : "text-muted-foreground"}>{line}</span>
              </div>
            );
          })}
        </div>
      )}

      {oauth.deviceCode && (
        <div className="bg-muted/50 flex flex-col items-center gap-3 rounded-md p-4">
          <p className="text-muted-foreground text-xs">
            Enter this code at{" "}
            <ExternalLink href={oauth.deviceCode.verificationUri} className="text-foreground">
              {oauth.deviceCode.verificationUri}
            </ExternalLink>
          </p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xl font-semibold tracking-widest">{oauth.deviceCode.userCode}</span>
            <CopyCodeButton code={oauth.deviceCode.userCode} />
          </div>
        </div>
      )}

      {oauth.request?.kind === "select" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{oauth.request.message}</p>
          <div className="flex flex-wrap gap-2">
            {oauth.request.options?.map((opt) => (
              <Button key={opt.id} size="sm" variant="outline" onClick={() => choose(opt.id)}>
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {textRequest && (
        <Field>
          <FieldLabel htmlFor="oauth-answer">{label}</FieldLabel>
          <Input
            id="oauth-answer"
            value={answer}
            placeholder={textRequest.placeholder}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setAnswer(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
          />
        </Field>
      )}

      {waiting && oauth.authUrl && (
        <p className="text-muted-foreground text-xs">
          Browser didn't open? <ExternalLink href={oauth.authUrl}>Open the sign-in page</ExternalLink>
        </p>
      )}

      {oauth.error && <ErrorBanner message={oauth.error} />}
    </div>
  );
}

function OAuthSignInBody({
  provider,
  oauth,
  onClose,
}: {
  provider: AuthProviderRow;
  oauth: OAuthLogin;
  onClose: () => void;
}) {
  const view = useOAuthSignInView(provider.provider, oauth);
  return (
    <DialogContent showCloseButton={false} className="flex flex-col gap-0 overflow-hidden p-0">
      <AppDialogHeader title={`Sign in to ${provider.displayName}`} />

      <div className="flex flex-col gap-4 p-6">
        <DialogDescription>Follow the steps to connect your {provider.displayName} account.</DialogDescription>
        <OAuthSignInProgress oauth={oauth} view={view} />
      </div>

      <DialogFooter className="border-t px-6 py-4">
        <Button variant="outline" onClick={onClose}>
          {oauth.error ? "Close" : "Cancel"}
        </Button>
        {view.textRequest && (
          <Button onClick={view.submit} disabled={!view.canSubmit}>
            Continue
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access failed; the code is still visible to copy by hand.
    }
  };

  return (
    <Button size="icon-xs" variant="ghost" aria-label="Copy code" onClick={copy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
