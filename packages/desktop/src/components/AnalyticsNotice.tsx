// One-time, non-blocking notice that anonymous usage analytics are on. Shown on
// first launch until acknowledged (persisted as `analyticsNoticeAcknowledged`). It is
// purely informational — analytics is already ON by default; this just discloses
// it and points to the opt-out, for GDPR transparency.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { settingsApi } from "../rpc/api";

export function AnalyticsNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    settingsApi
      .get()
      .then((s) => setShow(!s.analyticsNoticeAcknowledged))
      .catch(() => undefined);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    settingsApi.set({ analyticsNoticeAcknowledged: true }).catch(() => undefined);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-4 md:pb-6">
      {/* Mirror the thread/composer container so the card lines up with the input
          field above. The thread sets --thread-max-width: 44rem on its own root,
          which is out of scope here, so use the literal value + the same px-4. */}
      <div className="flex w-full max-w-[44rem] px-4">
        <div className="bg-popover text-popover-foreground pointer-events-auto flex w-full items-center gap-4 rounded-xl border px-4 py-3 shadow-lg">
          <p className="text-muted-foreground text-xs">
            We collect anonymous analytics to improve Accountant24. Your personal or financial data is never sent. You
            can turn this off any time in Settings → Privacy.
          </p>
          <Button variant="outline" size="sm" onClick={dismiss} className="shrink-0">
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
