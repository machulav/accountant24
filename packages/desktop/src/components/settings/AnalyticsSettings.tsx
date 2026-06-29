// Analytics — the opt-out for anonymous usage analytics. We default it ON
// (Aptabase is cookie-less, has no persistent device id, and never stores IP),
// so this page is where a user turns it off. Same read/patch pattern as the
// other settings pages.

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { settingsApi } from "../../rpc/api";
import type { AppSettings } from "../../rpc/types";
import { Switch } from "@/components/ui/switch";
import { ErrorBanner, Section } from "./parts";

export function AnalyticsSettings() {
  const [settings, setSettings] = useState<AppSettings>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    settingsApi.get().then(setSettings).catch(() => undefined);
  }, []);

  const patch = useCallback((p: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...p }));
    setSaveError(null);
    settingsApi
      .set(p)
      .catch((e) => setSaveError(`Couldn’t save settings: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  const enabled = settings.analyticsEnabled ?? true;

  return (
    <div>
      {saveError && (
        <div className="px-6 pt-5">
          <ErrorBanner message={saveError} />
        </div>
      )}
      <Section
        title="Analytics"
        description="Help improve Accountant24 by sharing anonymous analytics."
      >
        {/* The label must NOT wrap the Switch (a Radix Switch double-fires inside a
            wrapping label); point at it with htmlFor instead. */}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="analytics-enabled" className="min-w-0 cursor-pointer">
            <span className="block text-sm">Share anonymous analytics</span>
            <span className="text-muted-foreground block text-xs">
              Your personal or financial data is never sent.{" "}
              <a
                href="https://aptabase.com/legal/privacy"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                How this works
              </a>
              .
            </span>
          </label>
          <Switch
            id="analytics-enabled"
            checked={enabled}
            onCheckedChange={(v) => patch({ analyticsEnabled: v })}
          />
        </div>

        <div className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium">What we send</h3>
            <ul className="text-muted-foreground space-y-1.5 text-xs">
              {WE_SEND.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckIcon className="text-foreground/70 mt-0.5 size-3.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium">What we never send</h3>
            <ul className="text-muted-foreground space-y-1.5 text-xs">
              {WE_NEVER_SEND.map((item) => (
                <li key={item} className="flex gap-2">
                  <XIcon className="text-muted-foreground/70 mt-0.5 size-3.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>
    </div>
  );
}

const WE_SEND = [
  "App version",
  "Operating system",
  "Country, derived without storing your IP",
  "Anonymous events (counts only): app_installed, app_opened, chat_created, user_message_sent, analytics_enabled, analytics_disabled",
];

const WE_NEVER_SEND = [
  "Your personal data",
  "Your financial data",
  "Your messages, files, or journal entries",
  "Anything that identifies you",
];
