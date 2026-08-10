// Pending queued messages inside the composer shell: while the agent runs, a
// mid-run send waits in pi's queue (delivered at the next tool boundary) and
// shows here as a chip until pi turns it into a real user message. Rendered
// from `s.composer.queue`, which the react-pi runtime mirrors from pi's
// queue_update events. No remove control: pi supports no per-item mutation
// (Stop clears the whole queue and restores the text into the composer).

import { ComposerPrimitive } from "@assistant-ui/react";
import { CornerDownRightIcon } from "lucide-react";
import type { FC } from "react";
import { DirectiveSegments } from "@/components/accountant24/directive-chips";

export const ComposerQueuedMessages: FC = () => (
  <ComposerPrimitive.Queue>
    {({ queueItem }) => (
      <div
        data-slot="aui_composer-queue-chip"
        className="bg-muted text-muted-foreground mx-3 mt-2 flex min-w-0 items-center gap-1.5 self-start rounded-lg px-2.5 py-1 text-xs"
      >
        <CornerDownRightIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">
          <DirectiveSegments text={queueItem.prompt} />
        </span>
      </div>
    )}
  </ComposerPrimitive.Queue>
);
