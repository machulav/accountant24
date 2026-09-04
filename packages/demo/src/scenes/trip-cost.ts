import type { FeatureDemo } from "../shared/types";

// A question over the ledger, answered as a table: the London trip from the
// memory scene, costed from its tag.
export const tripCost: FeatureDemo = {
  chatTitle: "London trip cost",
  user: { text: "What did the London trip cost?" },
  working: { steps: ["Query Ledger"], duration: "4s" },
  reply: {
    text: "Everything tagged :tag[trip_london] came to $1,860 over six days. Hotels were half of it:",
    table: {
      head: ["Account", "Total"],
      rows: [
        ["Hotel", "$940.00"],
        ["Restaurants", "$410.00"],
        ["Transport", "$310.00"],
        ["Other", "$200.00"],
      ],
    },
  },
};
