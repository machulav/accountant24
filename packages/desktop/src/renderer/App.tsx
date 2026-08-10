// Top-level gate: onboarding while no model is available (fresh install, or
// every provider removed), chat otherwise. `null` while the first check is in
// flight — render neither to avoid a flash of the wrong screen.

import { ChatLayout } from "./components/accountant24/chat-layout";
import { Onboarding } from "./components/accountant24/onboarding";
import { TooltipProvider } from "./components/shadcn/tooltip";
import { useHasModels } from "./hooks/use-provider-status";

export default function App() {
  const hasModels = useHasModels();
  if (hasModels === null) return null;
  return (
    // The app's one tooltip provider: every tooltip opens on dwell (400ms —
    // enough to filter cursor transit, snappier than the 600-700ms library
    // defaults), and once one is open, moving to a neighboring trigger opens
    // instantly (the provider shares the warm-up timer) — so scanning a row
    // of markers or pills never waits per item. Individual tooltips must NOT
    // wrap their own provider, or they leave the shared warm-up group.
    <TooltipProvider delay={400}>{hasModels ? <ChatLayout /> : <Onboarding />}</TooltipProvider>
  );
}
