// The subscription route of the connect step: sign in with a plan the user
// already pays for. Before the flow starts it is one button; once running it
// shows the same progress the Settings dialog shows, inline on the page.

import { Button } from "@/components/shadcn/button";
import type { OAuthLogin } from "@/hooks/use-oauth-login";
import { OAuthSignInProgress, useOAuthSignInView } from "../settings/provider-dialogs";

export function OAuthConnect({
  providerId,
  providerName,
  oauthName,
  loginLabel,
  oauth,
}: {
  providerId: string;
  providerName: string;
  /** pi's name for the subscription behind this provider, e.g. "Anthropic
   *  (Claude Pro/Max)" — it names the plan the user needs. */
  oauthName: string;
  /** pi's own wording for the sign-in action, when it has one. */
  loginLabel?: string;
  oauth: OAuthLogin;
}) {
  const view = useOAuthSignInView(providerId, oauth);
  const running = oauth.active === providerId || oauth.errorProvider === providerId;

  if (!running) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm text-pretty">Use your {oauthName} subscription.</p>
        <Button onClick={() => void oauth.start(providerId)}>{loginLabel ?? `Sign in to ${providerName}`}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <OAuthSignInProgress oauth={oauth} view={view} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => (oauth.active ? oauth.cancel() : oauth.dismissError())}>
          {oauth.error ? "Close" : "Cancel"}
        </Button>
        {view.textRequest && (
          <Button onClick={view.submit} disabled={!view.canSubmit}>
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}
