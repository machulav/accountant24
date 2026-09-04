// A looping example exchange for the welcome page: one prompt someone might
// type and the agent's short answer, cycling through the app's main use cases
// (the ones docs/docs/use-cases.mdx opens with). Decoration only: it is hidden
// from assistive tech and nothing in the flow depends on it.

import { useEffect, useState } from "react";
import { Bubble, BubbleContent } from "@/components/shadcn/bubble";

type UseCase = { prompt: string; reply: string };

export const USE_CASES: readonly UseCase[] = [
  { prompt: "I spent $45 at Whole Foods yesterday", reply: "Added to Expenses:Groceries." },
  {
    prompt: "Here is my March bank statement: ~/Downloads/statement-march.pdf",
    reply: "Imported 12 transactions, 3 were already in your ledger.",
  },
  { prompt: "How much did I spend on food this month?", reply: "$412 so far, a bit less than last month." },
  {
    prompt: "I'm in Italy April 10 to 15, tag those transactions trip_italy",
    reply: "Got it. I'll tag them as they come in.",
  },
];

export const USE_CASE_ROTATE_MS = 3500;

/** The index of the item to show, advancing every `intervalMs` and wrapping
 *  around. Stays at 0 when there is nothing to cycle through. */
export function useCycledIndex(count: number, intervalMs: number): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (count <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => clearInterval(id);
  }, [count, intervalMs]);
  return index;
}

export function UseCaseShowcase() {
  const index = useCycledIndex(USE_CASES.length, USE_CASE_ROTATE_MS);
  // Always in range: the index wraps within the list.
  const item = USE_CASES[index] as UseCase;
  return (
    // min-h: the longest exchange sets the height, so the page does not
    // reflow around the button when a shorter one comes up.
    <div aria-hidden className="flex min-h-28 flex-col gap-2">
      {/* Keyed by index so each exchange plays the entrance animation. */}
      <div
        key={index}
        className="animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none flex flex-col gap-2 duration-500"
      >
        {/* The same look as a sent message in the chat (thread.tsx): the
            secondary bubble on the composer's input surface. */}
        <Bubble variant="secondary" align="end" className="*:data-[slot=bubble-content]:bg-input/50">
          <BubbleContent>{item.prompt}</BubbleContent>
        </Bubble>
        {/* Replies are plain text in the chat, not bubbles. */}
        <p className="text-sm leading-relaxed">{item.reply}</p>
      </div>
    </div>
  );
}
