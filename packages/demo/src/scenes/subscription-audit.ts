import type { FeatureDemo } from "../shared/types";

// A plugin skill at work: the subscription audit from the default plugin.
export const subscriptionAudit: FeatureDemo = {
  chatTitle: "Subscription audit",
  user: { text: "Audit my subscriptions" },
  working: { steps: ["Use Skill: skills:subscription-audit", "Query Ledger"], duration: "10s" },
  reply: {
    text: "You pay for 9 subscriptions, $112 a month. Two have had no use logged since May:",
    table: {
      head: ["Subscription", "Monthly"],
      rows: [
        ["Hulu", "$17.99"],
        ["Peloton App", "$12.99"],
      ],
    },
  },
};
