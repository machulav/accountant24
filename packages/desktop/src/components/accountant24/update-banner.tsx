import { ArrowRightIcon, SparklesIcon } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/shadcn/button";
import { updateApi } from "@/rpc/api";

/** Shown in the sidebar footer once an update is downloaded and staged. Clicking
 *  it quits, applies the update, and relaunches (see `updateApi.install`). Built
 *  on the same outline Button as New Chat so both sidebar actions share one look,
 *  incl. the border staying visible on hover. The overrides only relax the fixed
 *  button metrics (height, centering) to fit the two-line content. */
export const UpdateBanner: FC<{ version: string }> = ({ version }) => {
  return (
    <Button
      variant="outline"
      onClick={() => void updateApi.install()}
      className="h-auto w-full justify-start gap-2 px-3 py-2.5 text-left"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
        <SparklesIcon />
      </span>
      <span className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate">Relaunch to update</span>
        <span className="truncate font-normal text-muted-foreground text-xs">v{version}</span>
      </span>
      <ArrowRightIcon className="text-muted-foreground" />
    </Button>
  );
};
