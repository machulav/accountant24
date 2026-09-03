// The chats the mock windows list in their sidebar: the hero conversation
// first, then one per feature, in page order. Selecting a chat scrolls to
// the section that plays it, so every chat carries that section's id.
export interface PageChat {
  title: string;
  /** The id of the page element that plays this chat. */
  target: string;
}

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
