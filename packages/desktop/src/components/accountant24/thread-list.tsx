"use client";

import {
  AuiIf,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { MoreHorizontalIcon, PlusIcon, TrashIcon } from "lucide-react";
import { type ComponentPropsWithoutRef, type FC, Fragment, forwardRef, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/shadcn/button";
import { Skeleton } from "@/components/shadcn/skeleton";
import { cn } from "@/lib/utils";
import { sessionsApi } from "@/rpc/api";

export const ThreadList: FC = () => {
  return (
    <ThreadListRoot>
      <ThreadListNew />
      <ThreadListItems />
    </ThreadListRoot>
  );
};

export const ThreadListRoot: FC<ComponentPropsWithoutRef<typeof ThreadListPrimitive.Root>> = ({
  className,
  ...props
}) => {
  return (
    <ThreadListPrimitive.Root
      data-slot="aui_thread-list-root"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    />
  );
};

export const ThreadListItems: FC<ComponentPropsWithoutRef<"div">> = ({ className, ...props }) => {
  return (
    <div data-slot="aui_thread-list-items" className={cn("flex flex-col gap-0.5", className)} {...props}>
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        <ThreadListItemGroups />
      </AuiIf>
    </div>
  );
};

const DAY_IN_MS = 86_400_000;

const dateGroupLabel = (time: number | undefined, startOfToday: number): string => {
  if (time === undefined || time >= startOfToday) return "Today";
  if (time >= startOfToday - DAY_IN_MS) return "Yesterday";
  return "Earlier";
};

type ThreadListGroup = { label: string; indices: number[] };

/** Session modified-time per thread, keyed by id (= the session file path).
 *  react-pi drops the date when mapping to the assistant-ui thread item, so we
 *  read it straight from the sessions list. Refetched whenever the set of
 *  threads changes (new/deleted/renamed chat). */
function useSessionTimes(threadIds: readonly string[]): Map<string, number> {
  const [times, setTimes] = useState<Map<string, number>>(new Map());
  const key = threadIds.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is a deliberate refetch trigger (thread set changed), not read in the body
  useEffect(() => {
    let cancelled = false;
    sessionsApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, number>();
        for (const s of res.sessions ?? []) {
          const t = Date.parse(s.modified);
          if (!Number.isNaN(t)) map.set(s.path, t);
        }
        setTimes(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);
  return times;
}

const ThreadListItemGroups: FC = () => {
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const times = useSessionTimes(threadIds);

  const groups = useMemo<ThreadListGroup[] | null>(() => {
    if (times.size === 0) return null;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // Unknown time (e.g. a brand-new, unsaved chat) sorts to the top / "Today".
    const time = (index: number) => times.get(threadIds[index]!) ?? Number.MAX_SAFE_INTEGER;
    const indices = threadIds.map((_, index) => index).sort((a, b) => time(b) - time(a));

    const result: ThreadListGroup[] = [];
    for (const index of indices) {
      const label = dateGroupLabel(times.get(threadIds[index]!), startOfToday);
      const lastGroup = result[result.length - 1];
      if (lastGroup?.label === label) {
        lastGroup.indices.push(index);
      } else {
        result.push({ label, indices: [index] });
      }
    }
    return result;
  }, [threadIds, times]);

  if (!groups) {
    return <ThreadListPrimitive.Items>{() => <ThreadListItem />}</ThreadListPrimitive.Items>;
  }

  return groups.map((group) => (
    <Fragment key={group.label}>
      <div
        data-slot="aui_thread-list-group-label"
        className="text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium"
      >
        {group.label}
      </div>
      {group.indices.map((index) => (
        <ThreadListPrimitive.ItemByIndex key={threadIds[index]} index={index} components={{ ThreadListItem }} />
      ))}
    </Fragment>
  ));
};

export const ThreadListNew = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Button> & { labelClassName?: string }
>(({ className, labelClassName, children, ...props }, ref) => {
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        ref={ref}
        variant="ghost"
        data-slot="aui_thread-list-new"
        className={cn(
          "hover:bg-foreground/[0.06] data-active:bg-foreground/[0.06] mt-3 h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <PlusIcon data-slot="aui_thread-list-new-icon" className="size-4 shrink-0" />
            <span data-slot="aui_thread-list-new-label" className={cn("whitespace-nowrap", labelClassName)}>
              New Chat
            </span>
          </>
        )}
      </Button>
    </ThreadListPrimitive.New>
  );
});

ThreadListNew.displayName = "ThreadListNew";

const SKELETON_ROWS = ["s1", "s2", "s3", "s4", "s5"];

const ThreadListSkeleton: FC = () => {
  return (
    <div className="flex flex-col gap-0.5">
      {SKELETON_ROWS.map((row) => (
        <div
          key={row}
          role="status"
          aria-label="Loading threads"
          data-slot="aui_thread-list-skeleton-wrapper"
          className="flex h-8 items-center px-2.5"
        >
          <Skeleton data-slot="aui_thread-list-skeleton" className="h-3.5 w-full" />
        </div>
      ))}
    </div>
  );
};

export const ThreadListItem: FC = () => {
  return (
    <ThreadListItemPrimitive.Root
      data-slot="aui_thread-list-item"
      className="group/thread-list-item hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] data-active:bg-foreground/[0.06] data-active:font-medium has-focus-visible:bg-foreground/[0.06] has-data-[state=open]:bg-foreground/[0.06] relative flex h-8 items-center rounded-md transition-colors focus-visible:outline-none"
    >
      <ThreadListItemPrimitive.Trigger
        data-slot="aui_thread-list-item-trigger"
        className="focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-center rounded-md px-2.5 text-start text-sm outline-none group-hover/thread-list-item:pe-9 group-has-focus-visible/thread-list-item:pe-9 group-has-data-[state=open]/thread-list-item:pe-9 focus-visible:ring-[3px]"
      >
        <span data-slot="aui_thread-list-item-title" className="min-w-0 flex-1 truncate">
          <ThreadListItemPrimitive.Title fallback="New Chat" />
        </span>
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemMore />
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemMore: FC = () => {
  return (
    <ThreadListItemMorePrimitive.Root>
      <ThreadListItemMorePrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-slot="aui_thread-list-item-more"
          className="absolute end-1.5 top-1/2 size-6 -translate-y-1/2 bg-transparent p-0 opacity-0 hover:bg-transparent group-hover/thread-list-item:opacity-100 group-has-focus-visible/thread-list-item:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontalIcon className="size-3.5" />
          <span className="sr-only">More options</span>
        </Button>
      </ThreadListItemMorePrimitive.Trigger>
      <ThreadListItemMorePrimitive.Content
        side="right"
        align="start"
        sideOffset={6}
        data-slot="aui_thread-list-item-more-content"
        className="bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-32 overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
      >
        <ThreadListItemPrimitive.Delete asChild>
          <ThreadListItemMorePrimitive.Item
            data-slot="aui_thread-list-item-more-item"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
          >
            <TrashIcon className="size-4" />
            Delete
          </ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Delete>
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  );
};
