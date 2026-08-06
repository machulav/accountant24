import { CheckIcon, CopyIcon } from "lucide-react";
import { HoverActionButton, HoverActions } from "@/components/accountant24/hover-actions";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";

/**
 * Themed block for raw code-like text (tool input/output). There is no stock
 * shadcn code component, so this follows the composer/bubble surface family —
 * borderless, translucent muted fill, rounded-3xl — like BubbleContent and the
 * composer. Wide content (hledger reports) scrolls horizontally instead of
 * wrapping, so column alignment survives.
 *
 * A copy action pill (the shared HoverActions surface, as on markdown tables)
 * sits in the top-right corner, revealed on hover or keyboard focus (and
 * pinned while the copied state shows). It copies `copyText`, or the children
 * when they are a plain string.
 */
export function CodeBlock({
  className,
  preClassName,
  children,
  copyText,
  ...props
}: React.ComponentProps<"pre"> & { copyText?: string; preClassName?: string }) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const textToCopy = copyText ?? (typeof children === "string" ? children : "");

  return (
    <div className={cn("group/hover-actions relative", className)}>
      <pre
        // text-muted-foreground: these blocks live inside the muted
        // chain-of-thought log; full-strength foreground reads too heavy there.
        // preClassName lets other surfaces (chat markdown) restyle the pre.
        className={cn(
          "bg-input/30 text-muted-foreground overflow-x-auto rounded-3xl px-4 py-3 text-xs leading-relaxed",
          preClassName,
        )}
        {...props}
      >
        {children}
      </pre>
      {textToCopy && (
        <HoverActions className={cn(isCopied && "opacity-100")}>
          <HoverActionButton
            tooltip={isCopied ? "Copied" : "Copy"}
            onClick={() => {
              if (!isCopied) copyToClipboard(textToCopy);
            }}
          >
            {isCopied ? (
              <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
            ) : (
              <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
            )}
          </HoverActionButton>
        </HoverActions>
      )}
    </div>
  );
}
