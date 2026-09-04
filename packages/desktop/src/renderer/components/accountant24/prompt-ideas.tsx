"use client";

// Prompt ideas under the composer on the New Chat page: five things to try,
// dealt fresh each time the page opens from decks that persist between
// visits, so every idea comes around before any repeats. A click puts the
// idea in the composer and focuses it; sending stays with the user.

import { ThreadPrimitive } from "@assistant-ui/react";
import { type FC, useEffect, useState } from "react";
import { loadPromptIdeaDecks, savePromptIdeaDecks } from "@/components/accountant24/prompt-idea-decks";
import { Button } from "@/components/shadcn/button";
import { trackPromptIdeaUsed } from "@/lib/analyticsEvents";
import { dealPromptIdeas, GETTING_STARTED_MAX_TRANSACTIONS } from "@/lib/promptIdeas";

/** Focus the composer once the clicked idea has landed in it. The
 *  suggestion's own handler (the composer setText) runs after ours, and the
 *  Lexical sync commits that text with the caret at its end in a microtask;
 *  a frame later a native focus keeps the caret there, so typing continues
 *  after the idea. Same idiom as the New Chat action on the report pages. */
function focusComposerInput(): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(".aui-lexical-input")?.focus());
}

/** `transactionCount` null = not known yet: nothing renders, so the wrong
 *  set never flashes before the right one. */
export const PromptIdeas: FC<{ transactionCount: number | null }> = ({ transactionCount }) => {
  if (transactionCount === null) return null;
  const phase = transactionCount > GETTING_STARTED_MAX_TRANSACTIONS ? "explore" : "getting-started";
  // Keyed by phase: crossing the threshold deals a fresh hand; nothing else
  // re-deals while the page stays open.
  return <PromptIdeaList key={phase} transactionCount={transactionCount} />;
};

const PromptIdeaList: FC<{ transactionCount: number }> = ({ transactionCount }) => {
  // Dealt once per mount (the thread mounts this anew with every New Chat
  // visit) as a pure read of the stored decks; StrictMode may run the
  // initializer twice and keeps one hand. The decks are written back in the
  // effect, which is harmless when replayed.
  const [{ ideas, decks }] = useState(() => dealPromptIdeas(transactionCount, loadPromptIdeaDecks()));
  useEffect(() => {
    savePromptIdeaDecks(decks);
  }, [decks]);

  return (
    // A centered wrapping row of pills (the stock button is already pill
    // shaped) on the composer's axis; the entrance matches the welcome heading.
    <ul
      aria-label="Prompt ideas"
      className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex flex-wrap justify-center gap-2 duration-200"
    >
      {ideas.map((idea) => (
        <li key={idea.id}>
          {/* No `send`: the suggestion only sets the composer text. */}
          <ThreadPrimitive.Suggestion
            prompt={idea.prompt}
            asChild
            onClick={() => {
              trackPromptIdeaUsed(idea.id);
              focusComposerInput();
            }}
          >
            <Button variant="outline" size="sm">
              {idea.prompt}
            </Button>
          </ThreadPrimitive.Suggestion>
        </li>
      ))}
    </ul>
  );
};
