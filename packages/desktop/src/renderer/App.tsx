// Top-level gate: the onboarding wizard while no model is available (fresh
// install, or every provider removed), chat otherwise — see useAppScreen.
// Nothing renders while the first check is in flight, to avoid a flash of the
// wrong screen.

import { ChatLayout } from "./components/accountant24/chat-layout";
import { Onboarding } from "./components/accountant24/onboarding/onboarding";
import { TooltipProvider } from "./components/shadcn/tooltip";
import { useAppScreen } from "./hooks/use-app-screen";
import { useEnsureDefaultModel } from "./hooks/use-default-model";

export default function App() {
  const { screen, finishOnboarding } = useAppScreen();
  // Fills in a default model for setups that have models but never chose one.
  useEnsureDefaultModel();
  if (screen === "loading") return null;
  return (
    // The app's one tooltip provider: every tooltip opens on dwell (400ms —
    // enough to filter cursor transit, snappier than the 600-700ms library
    // defaults), and once one is open, moving to a neighboring trigger opens
    // instantly (the provider shares the warm-up timer) — so scanning a row
    // of markers or pills never waits per item. Individual tooltips must NOT
    // wrap their own provider, or they leave the shared warm-up group.
    <TooltipProvider delay={400}>
      {screen === "chat" ? <ChatLayout /> : <Onboarding onDone={finishOnboarding} />}
    </TooltipProvider>
  );
}
