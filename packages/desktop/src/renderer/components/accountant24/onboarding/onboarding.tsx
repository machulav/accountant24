// First-run onboarding wizard, shown by App in place of the whole chat layout
// while no model is available (fresh install, or every provider removed). Two
// steps: a welcome page that says what the app is, then the setup page where
// the user connects a provider and sees the model new chats will use. The
// wizard ends only when the user presses Start there (App keeps it mounted
// even once a model exists), so the second step is never cut short.

import { useState } from "react";
import { trackOnboardingCompleted, trackOnboardingSetupViewed } from "@/lib/analyticsEvents";
import { SetupStep } from "./setup-step";
import { WelcomeStep } from "./welcome-step";

type Step = "welcome" | "setup";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("welcome");

  const next = () => {
    trackOnboardingSetupViewed();
    setStep("setup");
  };
  const start = () => {
    trackOnboardingCompleted();
    onDone();
  };

  return (
    <div className="relative flex h-dvh flex-col">
      {/* drag strip so the frameless window can still be moved by its top edge */}
      <div className="app-drag-region absolute inset-x-0 top-0 z-20 h-7" />
      {step === "welcome" ? <WelcomeStep onNext={next} /> : <SetupStep onStart={start} />}
    </div>
  );
}
