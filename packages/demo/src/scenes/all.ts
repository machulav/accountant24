// Every scene in this package, for consumers that show them all and for the
// guards that keep each one short enough to watch.
import type { FeatureDemo, HeroDemo } from "../shared/types";
import { augustStatements } from "./august-statements";
import { costcoRule } from "./costco-rule";
import { groceries } from "./groceries";
import { lastMonth } from "./last-month";
import { modelMenu } from "./model-menu";
import { statementImport } from "./statement-import";
import { subscriptionAudit } from "./subscription-audit";
import { undo } from "./undo";

/** Conversations of more than one turn. */
export const heroScenes: HeroDemo[] = [augustStatements];

/** Single-turn scenes. */
export const featureScenes: FeatureDemo[] = [
  groceries,
  statementImport,
  costcoRule,
  lastMonth,
  subscriptionAudit,
  modelMenu,
  undo,
];
