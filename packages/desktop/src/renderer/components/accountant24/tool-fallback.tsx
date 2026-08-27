"use client";

import {
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartStatus,
  useToolCallElapsed,
} from "@assistant-ui/react";
import { AlertCircleIcon, CheckIcon, XIcon } from "lucide-react";
import { memo, useState } from "react";
import { CodeBlock } from "@/components/accountant24/code-block";
import {
  Disclosure,
  DisclosureChevron,
  DisclosureContent,
  DisclosureTrigger,
  ShimmerLabel,
} from "@/components/accountant24/disclosure";
import { Spinner } from "@/components/shadcn/spinner";
import { formatDuration } from "@/lib/duration";
import { isMemoryReadCall, isMemoryUpdateCall } from "@/lib/memory-tool";
import { docsReadPages, skillReadName } from "@/lib/skill-docs-tool";
import { TOOL_LABELS } from "@/lib/tool-labels";
import { cn } from "@/lib/utils";

type ToolStatus = ToolCallMessagePartStatus["type"];

const statusIconMap: Record<ToolStatus, React.ElementType> = {
  running: Spinner,
  complete: CheckIcon,
  incomplete: XIcon,
  "requires-action": AlertCircleIcon,
};

// TOOL_LABELS covers the custom tools and pi's built-ins (the event stream
// only carries tool names). Tools without an entry show their raw name.
export const toolLabel = (toolName: string) => TOOL_LABELS[toolName] ?? toolName;

// Memory, skills and the bundled documentation ride on the generic file/shell
// tools; only the step label is specialized so the user can see what is
// touched, naming the skill or page when the call says which.
export const toolCallLabel = (toolName: string, args: unknown) => {
  if (isMemoryUpdateCall(toolName, args)) return "Update Memory";
  if (isMemoryReadCall(toolName, args)) return "Read Memory";
  const skill = skillReadName(toolName, args);
  if (skill !== undefined) return skill ? `Use Skill: ${skill}` : "Use Skill";
  const pages = docsReadPages(toolName, args);
  if (pages !== undefined) return pages.length ? `Read Docs: ${pages.join(", ")}` : "Read Docs";
  return toolLabel(toolName);
};

function ToolFallbackDuration() {
  const elapsedMs = useToolCallElapsed();
  if (elapsedMs === undefined) return null;

  return (
    <span data-slot="tool-fallback-duration" className="text-muted-foreground text-xs tabular-nums">
      {formatDuration(elapsedMs)}
    </span>
  );
}

function ToolFallbackTrigger({
  label,
  status,
  isError = false,
}: {
  label: string;
  status?: ToolCallMessagePartStatus;
  isError?: boolean;
}) {
  const statusType = status?.type ?? "complete";
  const isRunning = statusType === "running";
  const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";

  // A tool can return an error while the run continues: the part completes
  // normally but carries `isError`, so the checkmark would be misleading.
  const Icon = isError && !isRunning ? XIcon : statusIconMap[statusType];

  return (
    <DisclosureTrigger data-slot="tool-fallback-trigger" className="w-fit origin-left">
      <Icon
        data-slot="tool-fallback-trigger-icon"
        className={cn("size-4 shrink-0", isCancelled && "text-muted-foreground")}
      />
      <ShimmerLabel
        data-slot="tool-fallback-trigger-label"
        active={isRunning}
        className={cn("text-start font-medium", isCancelled && "text-muted-foreground line-through")}
      >
        {label}
      </ShimmerLabel>
      <ToolFallbackDuration />
      <DisclosureChevron data-slot="tool-fallback-trigger-chevron" />
    </DisclosureTrigger>
  );
}

function ToolFallbackContent({ children }: React.PropsWithChildren) {
  return (
    <DisclosureContent data-slot="tool-fallback-content" className="text-sm">
      <div
        className={cn(
          "flex flex-col gap-2 ps-6 pt-1 pb-2 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none",
          "group-data-open/disclosure-content:animate-in group-data-open/disclosure-content:fade-in-0 group-data-open/disclosure-content:blur-in-[2px] group-data-open/disclosure-content:slide-in-from-top-1",
          "group-data-closed/disclosure-content:animate-out group-data-closed/disclosure-content:fade-out-0 group-data-closed/disclosure-content:blur-out-[2px] group-data-closed/disclosure-content:slide-out-to-top-1",
          "group-data-closed/disclosure-content:duration-(--animation-duration) group-data-open/disclosure-content:duration-(--animation-duration)",
        )}
      >
        {children}
      </div>
    </DisclosureContent>
  );
}

/** Pretty-print a JSON object/array with 2-space indentation. Anything else —
 *  plain text, scalars, or incomplete JSON (args still streaming) — is
 *  returned as-is. */
export const prettyPrintJson = (text: string) => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return text;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
};

function ToolFallbackArgs({ argsText, className }: { argsText?: string; className?: string }) {
  if (!argsText) return null;

  return (
    <div data-slot="tool-fallback-args" className={className}>
      <p className="text-muted-foreground text-xs font-medium">Input:</p>
      <CodeBlock className="mt-1">{prettyPrintJson(argsText)}</CodeBlock>
    </div>
  );
}

function ToolFallbackResult({ result, isError = false }: { result?: unknown; isError?: boolean }) {
  if (result === undefined) return null;

  return (
    <div data-slot="tool-fallback-result">
      <p className="text-muted-foreground text-xs font-medium">{isError ? "Error:" : "Output:"}</p>
      <CodeBlock className="mt-1">
        {typeof result === "string" ? prettyPrintJson(result) : JSON.stringify(result, null, 2)}
      </CodeBlock>
    </div>
  );
}

function ToolFallbackError({ status }: { status?: ToolCallMessagePartStatus }) {
  if (status?.type !== "incomplete") return null;

  const error = status.error;
  const errorText = error ? (typeof error === "string" ? error : JSON.stringify(error)) : null;

  if (!errorText) return null;

  const isCancelled = status.reason === "cancelled";
  const headerText = isCancelled ? "Cancelled reason:" : "Error:";

  return (
    <div data-slot="tool-fallback-error">
      <p className="text-muted-foreground font-semibold">{headerText}</p>
      <p className="text-muted-foreground">{errorText}</p>
    </div>
  );
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({ toolName, args, argsText, result, isError, status }) => {
  const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";
  const label = toolCallLabel(toolName, args);

  const [open, setOpen] = useState(false);

  return (
    <Disclosure data-slot="tool-fallback-root" open={open} onOpenChange={setOpen} className="w-full">
      <ToolFallbackTrigger label={label} status={status} isError={isError} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs argsText={argsText} className={cn(isCancelled && "opacity-60")} />
        {!isCancelled && <ToolFallbackResult result={result} isError={isError} />}
      </ToolFallbackContent>
    </Disclosure>
  );
};

export const ToolFallback = memo(ToolFallbackImpl);
ToolFallback.displayName = "ToolFallback";
