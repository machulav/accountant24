// A long block of sent text, clamped to a few lines with a toggle to reveal it.
//
// Clamping is CSS (line-clamp), not truncation, so the full text stays in the
// DOM: selection, copy and screen readers all still see the whole message, and
// expanding is instant with no reflow of the text itself.

import { useState } from "react";
import { cn } from "@/lib/utils";

/** How much of an overlong message stays visible when collapsed. */
const CLAMP_LINES = "line-clamp-8";

export function CollapsedText({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className={cn(!expanded && CLAMP_LINES)}>{children}</div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        // Same affordance as the disclosure triggers: quiet by default, and it
        // sits inside the bubble so it reads as part of the message.
        className="text-muted-foreground hover:text-foreground mt-1 text-sm transition-[color,scale] active:scale-[0.98]"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </>
  );
}
