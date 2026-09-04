// Which top-level screen the app shows: the onboarding wizard while no model
// is available (fresh install, or every provider removed), the chat otherwise.
// The first status check decides; after that the wizard owns its own exit. A
// model landing mid-wizard (the user just connected a provider) must not tear
// the wizard down before its last step, so only finishOnboarding() moves from
// onboarding to chat. Nothing is persisted: a relaunch re-runs the check, and
// a workspace with models goes straight to the chat.

import { useCallback, useEffect, useState } from "react";
import { useHasModels } from "./use-provider-status";

export type AppScreen = "loading" | "onboarding" | "chat";

export function useAppScreen(): { screen: AppScreen; finishOnboarding: () => void } {
  const hasModels = useHasModels();
  const [screen, setScreen] = useState<AppScreen>("loading");

  useEffect(() => {
    if (hasModels === null) return;
    setScreen((prev) => {
      if (prev === "loading") return hasModels ? "chat" : "onboarding";
      // Losing every model in the chat (Settings → Disconnect) reopens the
      // wizard; gaining one inside the wizard changes nothing.
      return prev === "chat" && !hasModels ? "onboarding" : prev;
    });
  }, [hasModels]);

  const finishOnboarding = useCallback(() => setScreen("chat"), []);

  return { screen, finishOnboarding };
}
