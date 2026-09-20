// First-run onboarding, shown by App in place of the whole chat layout while no
// model is available (fresh install, or every provider removed). Two steps in
// one centered column: what the app is, then connecting a model. The wizard
// ends only when the user opens the app from the last step (App keeps it
// mounted even once a model exists), so the connect step is never cut short.

import { useState } from "react";
import { trackOnboardingCompleted, trackOnboardingSetupViewed } from "@/lib/analyticsEvents";
import { ConnectStep } from "./connect-step";
import { StepIndicator } from "./step-indicator";
import { WelcomeStep } from "./welcome-step";

type Step = "welcome" | "connect";

const STEP_NUMBER: Record<Step, number> = { welcome: 1, connect: 2 };

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("welcome");

  const next = () => {
    trackOnboardingSetupViewed();
    setStep("connect");
  };
  const open = () => {
    trackOnboardingCompleted();
    onDone();
  };

  return (
    <div className="font-display relative h-dvh overflow-y-auto">
      {/* drag strip so the frameless window can still be moved by its top edge */}
      <div className="app-drag-region absolute inset-x-0 top-0 z-20 h-7" />
      <div className="flex min-h-full flex-col px-6 pt-12 pb-6">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          {/* Keyed by step so each one plays its entrance. */}
          <div key={step} className="animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none duration-300">
            {step === "welcome" ? <WelcomeStep onNext={next} /> : <ConnectStep onOpen={open} />}
          </div>
        </div>
        <div className="pt-10">
          <StepIndicator step={STEP_NUMBER[step]} total={2} />
        </div>
      </div>
    </div>
  );
}
