// The prompt ideas' decks between New Chat visits — the same best-effort
// localStorage idiom as the sidebar width and the table configs: load
// validates the stored value and falls back to fresh decks, save never
// throws. Which ideas come next is a convenience, not data, so it lives with
// the other UI preferences rather than in the workspace.

import { PROMPT_IDEA_GROUPS, type PromptIdeaDecks } from "@/lib/promptIdeas";

const STORAGE_KEY = "accountant24.prompt-idea-decks";

/** The stored decks; unknown groups and non-string entries are dropped, and
 *  anything unreadable means fresh decks. */
export function loadPromptIdeaDecks(): PromptIdeaDecks {
  let stored: unknown;
  try {
    stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return {};
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const decks: PromptIdeaDecks = {};
  for (const group of PROMPT_IDEA_GROUPS) {
    const deck = (stored as Record<string, unknown>)[group.id];
    if (Array.isArray(deck)) decks[group.id] = deck.filter((id): id is string => typeof id === "string");
  }
  return decks;
}

export function savePromptIdeaDecks(decks: PromptIdeaDecks): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
  } catch {
    // Persistence is best-effort; the next visit simply reshuffles.
  }
}
