// Every scene in this package, for consumers that show them all and for the
// guards that keep each one short enough to watch.
import type { FeatureDemo, HeroDemo } from "../shared/types";
import { augustStatements } from "./august-statements";
import { groceries } from "./groceries";
import { londonTrip } from "./london-trip";
import { modelMenu } from "./model-menu";
import { statementImport } from "./statement-import";
import { subscriptionAudit } from "./subscription-audit";
import { tripCost } from "./trip-cost";
import { undo } from "./undo";

/** Conversations of more than one turn. */
export const heroScenes: HeroDemo[] = [augustStatements];

/** Single-turn scenes. */
export const featureScenes: FeatureDemo[] = [
  groceries,
  statementImport,
  londonTrip,
  tripCost,
  subscriptionAudit,
  modelMenu,
  undo,
];
