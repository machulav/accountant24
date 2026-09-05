import type { FeatureDemo } from "../shared/types";

// Memory: a trip mentioned once, tagged automatically while it happens, so
// the cost is one question away afterwards.
export const londonTrip: FeatureDemo = {
  chatTitle: "London in September",
  user: { text: "I'm in London September 10th to 15th, tag everything from the trip" },
  working: { steps: ["Update Memory", "Commit"], duration: "2s" },
  reply: {
    text: "Got it. Spending between September 10 and 15 gets :tag[trip_london], not regular bills like rent. Ask what the trip cost when you're back.",
  },
};
