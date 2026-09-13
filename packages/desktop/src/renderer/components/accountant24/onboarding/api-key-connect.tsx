// The API key route of the connect step: the same field the Settings dialog
// uses, laid out for the page.

import { ApiKeyConnectButton, ApiKeyField, useApiKeyForm } from "../settings/provider-dialogs";

export function ApiKeyConnect({
  providerId,
  providerName,
  onConnected,
}: {
  providerId: string;
  providerName: string;
  onConnected: () => void | Promise<void>;
}) {
  const form = useApiKeyForm(providerId, onConnected);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm text-pretty">
        Paste an API key from your {providerName} account. It is stored only on this device.
      </p>
      <ApiKeyField form={form} />
      <ApiKeyConnectButton form={form} />
    </div>
  );
}
