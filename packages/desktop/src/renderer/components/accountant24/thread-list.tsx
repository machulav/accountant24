"use client";

import { AuiIf, ThreadListItemPrimitive, ThreadListPrimitive, useAuiState } from "@assistant-ui/react";
import { MoreHorizontalIcon, PlusIcon, TrashIcon } from "lucide-react";
import { type FC, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/shadcn/sidebar";
import { cn } from "@/lib/utils";
import { sessionsApi } from "@/rpc/api";

/** The sidebar's primary action — lives in the SidebarHeader, outside the nav
 *  list, per the shadcn sidebar recipe (header = actions, content = nav).
 *  `onSelect` fires alongside the primitive's new-thread action (the layout
 *  uses it to bring the chat view back). */
export const ThreadListNew: FC<{ onSelect?: () => void }> = ({ onSelect }) => {
  return (
    <ThreadListPrimitive.New asChild>
      <Button variant="outline" data-slot="aui_thread-list-new" className="w-full" onClick={onSelect}>
        <PlusIcon data-icon="inline-start" />
        New Chat
      </Button>
    </ThreadListPrimitive.New>
  );
};

/** `onSelectThread` fires when a thread row is clicked, alongside the
 *  primitive's switch-to-thread action (not on the row's ••• actions).
 *  `highlightActive` mutes the active-thread highlight while another sidebar
 *  destination (the Net Worth) is the selected one — the runtime thread
 *  stays active underneath, but the sidebar must not show two selections. */
export const ThreadList: FC<{ onSelectThread?: () => void; highlightActive?: boolean }> = ({
  onSelectThread,
  highlightActive = true,
}) => {
  return (
    <ThreadListPrimitive.Root data-slot="aui_thread-list-root" className="flex flex-col">
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        <ThreadListItemGroups onSelectThread={onSelectThread} highlightActive={highlightActive} />
      </AuiIf>
    </ThreadListPrimitive.Root>
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

const ThreadListItemGroups: FC<{ onSelectThread?: () => void; highlightActive?: boolean }> = ({
  onSelectThread,
  highlightActive,
}) => {
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const times = useSessionTimes(threadIds);

  // ItemByIndex takes a component (not an element), so bind the callback once.
  const BoundThreadListItem = useMemo(() => {
    const Bound: FC = () => <ThreadListItem onSelect={onSelectThread} highlightActive={highlightActive} />;
    return Bound;
  }, [onSelectThread, highlightActive]);

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
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <ThreadListPrimitive.Items>{() => <BoundThreadListItem />}</ThreadListPrimitive.Items>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return groups.map((group) => (
    <SidebarGroup key={group.label}>
      <SidebarGroupLabel data-slot="aui_thread-list-group-label">{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.indices.map((index) => (
            <ThreadListPrimitive.ItemByIndex
              key={threadIds[index]}
              index={index}
              components={{ ThreadListItem: BoundThreadListItem }}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ));
};

const SKELETON_ROWS = ["s1", "s2", "s3", "s4", "s5"];

const ThreadListSkeleton: FC = () => {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu role="status" aria-label="Loading threads">
          {SKELETON_ROWS.map((row) => (
            <SidebarMenuItem key={row}>
              <SidebarMenuSkeleton data-slot="aui_thread-list-skeleton" />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export const ThreadListItem: FC<{ onSelect?: () => void; highlightActive?: boolean }> = ({
  onSelect,
  highlightActive = true,
}) => {
  return (
    <ThreadListItemPrimitive.Root asChild>
      <SidebarMenuItem data-slot="aui_thread-list-item" className="group/thread-list-item">
        <ThreadListItemPrimitive.Trigger asChild>
          {/* Active-thread highlight: aui marks the Root (the <li>) with
              data-active, so mirror the button's own data-active styles off
              the parent — but only while the chat is the selected sidebar
              destination (highlightActive); the runtime thread stays active
              while the Net Worth is open, and the sidebar must not show
              two selections. Same for an open "more" menu keeping the row
              lit. group-hover: the ••• action is a sibling overlaying the
              row, so the button's own :hover drops while the pointer is on
              it — key the hover highlight off the whole row instead. */}
          <SidebarMenuButton
            data-slot="aui_thread-list-item-trigger"
            onClick={onSelect}
            className={cn(
              "group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-data-popup-open/menu-item:bg-sidebar-accent",
              highlightActive &&
                "group-data-active/menu-item:bg-sidebar-accent group-data-active/menu-item:text-sidebar-accent-foreground group-data-active/menu-item:font-medium",
            )}
          >
            <span data-slot="aui_thread-list-item-title" className="min-w-0 flex-1 truncate">
              <ThreadListItemPrimitive.Title fallback="New Chat" />
            </span>
          </SidebarMenuButton>
        </ThreadListItemPrimitive.Trigger>
        <ThreadListItemMore />
      </SidebarMenuItem>
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemMore: FC = () => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          /* right-2: match the button's px-3 text inset optically — the stock
             right-1 leaves the icon glued to the pill's rounded corner.
             opacity-0: stock showOnHover only hides actions at md+ (it assumes
             narrow = touch with no hover) — this desktop app always has a
             mouse, so hide-until-hover applies in the narrow drawer mode too. */
          <SidebarMenuAction showOnHover data-slot="aui_thread-list-item-more" className="right-2 opacity-0">
            <MoreHorizontalIcon />
            <span className="sr-only">More options</span>
          </SidebarMenuAction>
        }
      />
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={6}
        // Mouse dismissal must NOT return focus to the ••• trigger — restored
        // focus reads as :focus-visible and pins the hover-only icon on screen.
        // Keyboard dismissal keeps the standard focus return (a11y).
        finalFocus={(closeType) => closeType === "keyboard"}
      >
        <ThreadListItemPrimitive.Delete asChild>
          <DropdownMenuItem variant="destructive" data-slot="aui_thread-list-item-more-item">
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </ThreadListItemPrimitive.Delete>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
