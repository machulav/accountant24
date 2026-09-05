// The chats the mock windows list in their sidebar: the hero conversation
// first, then one per feature, in page order. Selecting a chat scrolls to
// the section that plays it, so every chat carries that section's id.
import type { DemoChat } from "@accountant24/demo/shared/types";

/** A mock-sidebar chat whose target is the id of the section that plays it. */
export type PageChat = DemoChat;

export const HERO_DEMO_ID = "demo";

export function featureTargetId(index: number): string {
  return `feature-${index + 1}`;
}

export function buildPageChats(heroTitle: string, featureTitles: string[]): PageChat[] {
  return [
    { title: heroTitle, target: HERO_DEMO_ID },
    ...featureTitles.map((title, index) => ({ title, target: featureTargetId(index) })),
  ];
}
