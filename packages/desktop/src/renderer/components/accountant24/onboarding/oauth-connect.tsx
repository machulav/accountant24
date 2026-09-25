// The subscription route of the connect step: sign in with a plan the user
// already pays for. Before the flow starts it is one button; once running it
// shows the same progress the Settings dialog shows, inline on the page.
//
// "Sign in with Claude" can read as handing over a Claude account, so the
// line above the button says what the sign-in is for (the plan runs the
// model) and what it is not (access to the user's chats). The grant really
// is that narrow: the provider's consent page lists inference and profile
// scopes, nothing that reads conversations.

import { Button } from "@/components/shadcn/button";
import type { OAuthLogin } from "@/hooks/use-oauth-login";
import { OAuthSignInProgress, useOAuthSignInView } from "../settings/provider-dialogs";

/** Plain wording for the products people know by name. Any other provider
 *  gets pi's own name for its subscription. */
const PLAN_COPY: Record<string, string> = {
  anthropic: "Your Claude Pro or Max plan runs the model. Accountant24 gets no access to your Claude chats.",
  "openai-codex": "Your ChatGPT Plus or Pro plan runs the model. Accountant24 gets no access to your ChatGPT chats.",
};

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
        <p className="text-muted-foreground text-sm text-pretty">
          {PLAN_COPY[providerId] ?? `Use your ${oauthName} subscription to run the model.`}
        </p>
        <Button onClick={() => void oauth.start(providerId)}>{loginLabel ?? `Sign in with ${providerName}`}</Button>
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
