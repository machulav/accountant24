import { ArrowRightIcon, SparklesIcon } from "lucide-react";
import type { FC } from "react";
import { updateApi } from "@/rpc/api";

/** Shown in the sidebar footer once an update is downloaded and staged. Clicking
 *  it quits, applies the update, and relaunches (see `updateApi.install`). Mirrors
 *  the Claude desktop "Relaunch to update" banner: brand mark, label, version. */
export const UpdateBanner: FC<{ version: string }> = ({ version }) => {
  return (
    <button
      type="button"
      onClick={() => void updateApi.install()}
      className="app-no-drag flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <SparklesIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate font-medium text-sidebar-foreground text-sm">Relaunch to update</span>
        <span className="block truncate text-muted-foreground text-xs">v{version}</span>
      </span>
      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
};
