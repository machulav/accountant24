// Runtime helper for the features section: given the observed feature items'
// intersection state, decide which feature should be active. Pure so the
// IntersectionObserver wiring in features.astro stays a thin adapter.
export interface ActiveCandidate {
  index: number;
  isIntersecting: boolean;
  /** Distance from the item's center to the viewport center, px. */
  distanceToCenter: number;
}

export function pickActiveIndex(candidates: ActiveCandidate[], current: number): number {
  let best: ActiveCandidate | undefined;
  for (const candidate of candidates) {
    if (!candidate.isIntersecting) continue;
    if (best === undefined || candidate.distanceToCenter < best.distanceToCenter) best = candidate;
  }
  return best === undefined ? current : best.index;
}
