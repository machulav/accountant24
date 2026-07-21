// Top-level gate: onboarding while no model is available (fresh install, or
// every provider removed), chat otherwise. `null` while the first check is in
// flight — render neither to avoid a flash of the wrong screen.

import { ChatLayout } from "./components/accountant24/chat-layout";
import { Onboarding } from "./components/accountant24/onboarding";
import { useHasModels } from "./hooks/use-provider-status";

export default function App() {
  const hasModels = useHasModels();
  if (hasModels === null) return null;
  return hasModels ? <ChatLayout /> : <Onboarding />;
}
