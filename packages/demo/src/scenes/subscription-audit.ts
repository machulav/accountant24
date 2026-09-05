import type { FeatureDemo } from "../shared/types";

// A plugin skill at work: the user types `/`, picks the subscription audit
// from the default plugin's skills, and the skill drives the answer. The
// options are the default plugin's real skills, descriptions included; the
// picker clamps them like the app does. The reply shows the skill's callouts
// (a price increase, a duplicate, a renewal due soon), not its table.
export const subscriptionAudit: FeatureDemo = {
  chatTitle: "Subscription audit",
  user: {
    text: "",
    skill: {
      picked: "accountant24-skills:subscription-audit",
      options: [
        {
          name: "accountant24-skills:create-plugin",
          description:
            "Turns a routine the user describes into a plugin with a skill they can run again later, and updates the plugins the user created before. Use when the user asks to create a skill or a plugin, to save or remember a report or review they just asked for, or to turn something they do regularly into a repeatable command.",
        },
        {
          name: "accountant24-skills:recurring-spending",
          description:
            "Gives you an overview of everything you pay regularly, including rent, utilities, insurance, loans, phone and internet, plus subscriptions and memberships. Groups them into bills and subscriptions, totals them per month and per year, shows what is due in the next 30 days, and flags price increases.",
        },
        {
          name: "accountant24-skills:subscription-audit",
          description:
            "Reviews your subscriptions and memberships, like streaming, apps, SaaS, gym, and news services. Shows what each costs per month and per year, when it renews, and flags price increases, duplicate services, forgotten charges, and subscriptions you likely cancelled.",
        },
      ],
    },
  },
  working: { steps: ["Use Skill: accountant24-skills:subscription-audit", "Query Ledger"], duration: "10s" },
  reply: {
    text: "9 subscriptions, $142 a month, $1,703 a year. Three things stand out:",
    // The skill's callouts in its order: a price increase, a duplicate, an
    // annual renewal due soon. Each payee is a mention chip, as the app
    // renders them in a reply.
    bullets: [
      ":payee[Hulu] went from $14.99 to $17.99 in June, 20% more, $36 a year.",
      ":payee[Spotify] and :payee[Apple Music] overlap. Drop one, keep $132 a year.",
      ":payee[Amazon Prime] renews Oct 2 for $139. Four weeks to decide.",
    ],
  },
};
