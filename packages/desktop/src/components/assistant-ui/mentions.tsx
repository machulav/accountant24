"use client";

// @-mention support for the chat composer: type `@` to search and insert
// payees, accounts, and tags. Built on assistant-ui's trigger-popover + mention
// adapter (the recommended path) — the picker inserts a directive
// (`:payee[Acme]`, `:account[Expenses:Food]`, `:tag[trip]`) into the message,
// which `LedgerDirectiveText` renders back as an inline chip in the sent message.
// Entity names come from the main process (hledger over IPC), refreshed whenever
// the agent finishes a turn so newly-added payees/accounts/tags show up.

import { type TextMessagePartComponent, unstable_useMentionAdapter, useAuiState } from "@assistant-ui/react";
import type { DirectiveChipProps } from "@assistant-ui/react-lexical";
import { AtSignIcon, LandmarkIcon, StoreIcon, TagIcon } from "lucide-react";
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseMentions } from "@/lib/mentions";
import { cn } from "@/lib/utils";
import { ledgerApi } from "@/rpc/api";
import type { LedgerMentions } from "@/rpc/types";
import { ComposerTriggerPopover } from "./composer-trigger-popover";

const iconFor = (type: string): FC<{ className?: string }> => ICON_MAP[type as keyof typeof ICON_MAP] ?? AtSignIcon;

// Per-type colors (static strings so Tailwind keeps them). account=blue,
// payee=green, tag=yellow. Muted/desaturated dusty tones rather than Tailwind's
// vivid stock hues, so the chips read calm instead of bright. Each has a
// dark-mode variant.
const TYPE_COLORS: Record<string, string> = {
  account: "bg-[#d4def0] text-[#3f5685] dark:bg-[#2c3850] dark:text-[#a7bdde]",
  payee: "bg-[#d2e8db] text-[#3f6e55] dark:bg-[#293d31] dark:text-[#a3c9b1]",
  tag: "bg-[#efe1cd] text-[#856b41] dark:bg-[#3f3626] dark:text-[#d8c096]",
};

/** The single inline chip used for a mention — in the composer (Lexical
 *  directive chip), in sent user messages, and in assistant replies — so they
 *  all look identical. Uses assistant-ui's tested directive-chip alignment
 *  recipe (inline-flex + items-baseline + [&_svg]:self-center) so it sits on the
 *  surrounding text baseline, plus a per-type color. */
export const MentionPill: FC<{ type: string; label: string }> = ({ type, label }) => {
  const Icon = iconFor(type);
  return (
    <span
      data-directive-type={type}
      className={cn(
        "mx-px inline-flex items-baseline gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 align-baseline text-[13px] font-medium leading-none [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:self-center [&_svg]:opacity-75",
        TYPE_COLORS[type] ?? TYPE_COLORS.account,
      )}
    >
      <Icon />
      {label}
    </span>
  );
};

// Category id (popover drill-down + icon lookup) and the per-item directive
// `type` (serialized into the message + icon lookup when rendering chips). Keys
// here cover both so a single iconMap serves the popover and the chips.
const ICON_MAP = {
  accounts: LandmarkIcon,
  payees: StoreIcon,
  tags: TagIcon,
  account: LandmarkIcon,
  payee: StoreIcon,
  tag: TagIcon,
} as const;

const EMPTY: LedgerMentions = { accounts: [], payees: [], tags: [] };

const toItems = (type: string, names: readonly string[]) =>
  names.map((name) => ({ id: name, type, label: name, icon: type }));

/** Load mention data once on mount and refresh it each time a run completes
 *  (the agent may have added/renamed payees, accounts, or tags). */
function useLedgerMentions(): LedgerMentions {
  const [data, setData] = useState<LedgerMentions>(EMPTY);

  const refresh = useCallback(() => {
    let cancelled = false;
    ledgerApi
      .mentions()
      .then((m) => {
        if (!cancelled) setData(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  // Refetch on the running → idle edge (a turn just finished).
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    if (wasRunning.current && !isRunning) refresh();
    wasRunning.current = isRunning;
  }, [isRunning, refresh]);

  return data;
}

/** The `@` mention popover. Render inside the composer (within a
 *  `ComposerPrimitive.Unstable_TriggerPopoverRoot`). */
export const ComposerMentions: FC = () => {
  const { accounts, payees, tags } = useLedgerMentions();

  const categories = useMemo(
    () =>
      [
        { id: "accounts", label: "Accounts", items: toItems("account", accounts) },
        { id: "payees", label: "Payees", items: toItems("payee", payees) },
        { id: "tags", label: "Tags", items: toItems("tag", tags) },
      ].filter((c) => c.items.length > 0),
    [accounts, payees, tags],
  );

  const mention = unstable_useMentionAdapter({
    categories,
    includeModelContextTools: false,
    iconMap: ICON_MAP,
    fallbackIcon: AtSignIcon,
  });

  return <ComposerTriggerPopover char="@" {...mention} />;
};

/** Inline chip rendered inside the Lexical composer input for an inserted
 *  mention. */
export const MentionChip: FC<DirectiveChipProps> = ({ directiveType, label }) => (
  <MentionPill type={directiveType} label={label} />
);

/** Renders a sent user-message text part, turning mention directives into the
 *  same inline chips the composer shows (plain text passes through untouched). */
export const LedgerDirectiveText: TextMessagePartComponent = ({ text }) => {
  const segments = parseMentions(text);
  if (segments.length === 1 && segments[0]?.kind === "text") {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i} className="whitespace-pre-wrap">
            {seg.value}
          </span>
        ) : (
          <MentionPill key={i} type={seg.type} label={seg.label} />
        ),
      )}
    </>
  );
};
