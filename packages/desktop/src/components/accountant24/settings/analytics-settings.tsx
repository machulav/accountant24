// Analytics — the opt-out for anonymous usage analytics. We default it ON
// (Aptabase is cookie-less, has no persistent device id, and never stores IP),
// so this page is where a user turns it off. Same read/patch pattern as the
// other settings pages.

import { CheckIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/shadcn/field";
import { Switch } from "@/components/shadcn/switch";
import { settingsApi } from "@/rpc/api";
import type { AppSettings } from "@/rpc/types";
import { ErrorBanner, Section } from "./parts";

export function AnalyticsSettings() {
  // null = not loaded yet. The switch defaults to ON, so rendering it before the
  // stored value arrives flashes enabled→disabled for opted-out users.
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    settingsApi
      .get()
      .then(setSettings)
      .catch(() => setSettings({}));
  }, []);

  const patch = useCallback((p: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...p }));
    setSaveError(null);
    settingsApi
      .set(p)
      .catch((e) => setSaveError(`Couldn’t save settings: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  const enabled = settings === null ? null : (settings.analyticsEnabled ?? true);

  return (
    <div>
      {saveError && (
        <div className="px-6 pt-5">
          <ErrorBanner message={saveError} />
        </div>
      )}
      <Section title="Analytics" description="Help improve Accountant24 by sharing anonymous analytics.">
        {/* The label must NOT wrap the Switch (a Radix Switch double-fires inside a
            wrapping label); point at it with htmlFor instead. */}
        <Field orientation="horizontal">
          <FieldContent>
            {/* font-normal: matches the plain-weight row titles across Settings;
                the FieldLabel default (medium) reads as a second heading here. */}
            <FieldLabel htmlFor="analytics-enabled" className="font-normal">
              Share anonymous analytics
            </FieldLabel>
            {/* text-xs: match the Section descriptions — at the stock text-sm
                this line reads as body copy, not helper text. */}
            <FieldDescription className="text-xs">
              Your personal or financial data is never sent.{" "}
              <a href="https://aptabase.com/legal/privacy" target="_blank" rel="noreferrer">
                How this works
              </a>
              .
            </FieldDescription>
          </FieldContent>
          {enabled !== null && (
            <Switch id="analytics-enabled" checked={enabled} onCheckedChange={(v) => patch({ analyticsEnabled: v })} />
          )}
        </Field>

        {/* mt-2 on top of the Section's gap-4 = 24px, so the send/never-send
            reference sits apart from the toggle instead of crowding it. */}
        <div className="mt-2 grid gap-x-6 gap-y-5 sm:grid-cols-2">
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

const WE_SEND = ["App version", "Operating system", "Country and region", "Anonymous events"];

const WE_NEVER_SEND = [
  "Your personal data",
  "Your financial data",
  "Your messages, files, or journal entries",
  "Your IP address",
  "Anything that identifies you",
];
