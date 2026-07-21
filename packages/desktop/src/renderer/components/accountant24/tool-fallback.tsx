"use client";

import {
  type ToolApprovalOption,
  type ToolCallMessagePart,
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartProps,
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
import { Button } from "@/components/shadcn/button";
import { Spinner } from "@/components/shadcn/spinner";
import { formatDuration } from "@/lib/duration";
import { TOOL_LABELS } from "@/lib/tool-labels";
import { cn } from "@/lib/utils";

const pressable = "active:scale-[0.98]";

type ToolStatus = ToolCallMessagePartStatus["type"];

const statusIconMap: Record<ToolStatus, React.ElementType> = {
  running: Spinner,
  complete: CheckIcon,
  incomplete: XIcon,
  "requires-action": AlertCircleIcon,
};

// TOOL_LABELS mirrors the pi extension's `label` metadata (the event stream
// only carries tool names). Unknown tools fall back to a humanized key.
export const toolLabel = (toolName: string) =>
  TOOL_LABELS[toolName] ?? `${toolName.charAt(0).toUpperCase()}${toolName.slice(1)}`.replace(/[_-]+/g, " ");

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
  toolName,
  status,
  isError = false,
}: {
  toolName: string;
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
        {toolLabel(toolName)}
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

const APPROVED_RESULT = "Approved by user";
const DENIED_RESULT = "User denied tool execution";

const APPROVAL_OPTION_DEFAULT_LABELS: Record<string, string> = {
  "allow-once": "Allow",
  "allow-always": "Always allow",
  "reject-once": "Deny",
  "reject-always": "Always deny",
};

const isAllowKind = (kind: string) => kind === "allow-once" || kind === "allow-always";

const approvalOptionLabel = (option: ToolApprovalOption) =>
  option.label ??
  (Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, option.kind)
    ? APPROVAL_OPTION_DEFAULT_LABELS[option.kind]
    : undefined) ??
  option.id;

function ToolFallbackApproval({
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
}: Partial<Pick<ToolCallMessagePartProps, "addResult" | "resume" | "respondToApproval">> & {
  interrupt?: ToolCallMessagePart["interrupt"];
  approval?: ToolCallMessagePart["approval"];
}) {
  const [submitted, setSubmitted] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (approval != null && (approval.approved !== undefined || approval.resolution !== undefined)) return null;

  // Custom (`_`-prefixed) kinds cannot be resolved to a boolean by the kit;
  // hosts using custom kinds render their own bar. A declared option list is
  // a host constraint: the kit never adds an approval path beyond it, but
  // always preserves a refusal path.
  const declaredOptions = respondToApproval ? approval?.options : undefined;
  const options = declaredOptions?.filter((o) => Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, o.kind));

  const respond = (approved: boolean) => {
    if (submitted) return;
    if (approval != null && approval.approved === undefined && respondToApproval) {
      respondToApproval({ approved });
    } else if (interrupt) {
      resume?.({ approved });
    } else {
      addResult?.(approved ? APPROVED_RESULT : DENIED_RESULT);
    }
    setSubmitted(true);
  };

  const respondWithOption = (option: ToolApprovalOption) => {
    if (submitted) return;
    respondToApproval?.({ optionId: option.id });
    setSubmitted(true);
    setConfirmingId(null);
  };

  const handleOption = (option: ToolApprovalOption) => {
    if (option.confirm) {
      setConfirmingId(option.id);
    } else {
      respondWithOption(option);
    }
  };

  const confirming = confirmingId != null ? options?.find((o) => o.id === confirmingId) : undefined;

  if (confirming) {
    const confirmMeta = typeof confirming.confirm === "object" ? confirming.confirm : undefined;
    const confirmDescription = confirmMeta?.description ?? confirming.description;
    return (
      <div data-slot="tool-fallback-approval-confirm" className="flex flex-col gap-2 pt-1">
        <p className="font-semibold">{confirmMeta?.title ?? `${approvalOptionLabel(confirming)}?`}</p>
        {confirmDescription && <p className="text-muted-foreground">{confirmDescription}</p>}
        {confirming.grants && confirming.grants.length > 0 && (
          <ul className="flex flex-col gap-1">
            {confirming.grants.map((grant) => (
              <li key={grant}>
                <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{grant}</code>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" className={pressable} onClick={() => respondWithOption(confirming)} disabled={submitted}>
            Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={pressable}
            onClick={() => setConfirmingId(null)}
            disabled={submitted}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (declaredOptions && declaredOptions.length > 0) {
    const allowOptions = options?.filter((o) => isAllowKind(o.kind)) ?? [];
    const rejectOptions = options?.filter((o) => !isAllowKind(o.kind)) ?? [];
    return (
      <div data-slot="tool-fallback-approval" className="flex flex-wrap items-center gap-2 pt-1">
        {[...allowOptions, ...rejectOptions].map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={option === allowOptions[0] ? "default" : "outline"}
            className={pressable}
            onClick={() => handleOption(option)}
            disabled={submitted}
          >
            {approvalOptionLabel(option)}
          </Button>
        ))}
        {rejectOptions.length === 0 && (
          <Button size="sm" variant="outline" className={pressable} onClick={() => respond(false)} disabled={submitted}>
            Deny
          </Button>
        )}
      </div>
    );
  }

  return (
    <div data-slot="tool-fallback-approval" className="flex items-center gap-2 pt-1">
      <Button size="sm" className={pressable} onClick={() => respond(true)} disabled={submitted}>
        Allow
      </Button>
      <Button size="sm" variant="outline" className={pressable} onClick={() => respond(false)} disabled={submitted}>
        Deny
      </Button>
    </div>
  );
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  isError,
  status,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
}) => {
  const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";
  const isRequiresAction = status?.type === "requires-action";

  const [open, setOpen] = useState(isRequiresAction);
  const [prevRequiresAction, setPrevRequiresAction] = useState(isRequiresAction);
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction);
    if (isRequiresAction) setOpen(true);
  }

  return (
    <Disclosure data-slot="tool-fallback-root" open={open} onOpenChange={setOpen} className="w-full">
      <ToolFallbackTrigger toolName={toolName} status={status} isError={isError} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs argsText={argsText} className={cn(isCancelled && "opacity-60")} />
        {isRequiresAction && (
          <ToolFallbackApproval
            addResult={addResult}
            resume={resume}
            interrupt={interrupt}
            approval={approval}
            respondToApproval={respondToApproval}
          />
        )}
        {!isCancelled && <ToolFallbackResult result={result} isError={isError} />}
      </ToolFallbackContent>
    </Disclosure>
  );
};

export const ToolFallback = memo(ToolFallbackImpl);
ToolFallback.displayName = "ToolFallback";
