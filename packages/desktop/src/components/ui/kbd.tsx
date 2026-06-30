import type * as React from "react";

import { cn } from "@/lib/utils";

/** A single keycap, e.g. ⌘ or N. Styled with the shared design tokens. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "bg-muted text-muted-foreground pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center rounded border px-1.5 font-sans text-xs font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
