import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";

/**
 * Themed block for raw code-like text (tool input/output). There is no stock
 * shadcn code component, so this follows the composer/bubble surface family —
 * borderless, translucent muted fill, rounded-3xl — like BubbleContent and the
 * composer. Wide content (hledger reports) scrolls horizontally instead of
 * wrapping, so column alignment survives.
 *
 * A copy button sits in the top-right corner, revealed on hover or keyboard
 * focus (and pinned while the copied state shows). It copies `copyText`, or
 * the children when they are a plain string.
 */
export function CodeBlock({
  className,
  children,
  copyText,
  ...props
}: React.ComponentProps<"pre"> & { copyText?: string }) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const textToCopy = copyText ?? (typeof children === "string" ? children : "");

  return (
    <div className={cn("group/code-block relative", className)}>
      <pre
        // text-muted-foreground: these blocks live inside the muted
        // chain-of-thought log; full-strength foreground reads too heavy there.
        className={cn(
          "bg-input/30 text-muted-foreground overflow-x-auto rounded-3xl px-4 py-3 text-xs leading-relaxed",
        )}
        {...props}
      >
        {children}
      </pre>
      {textToCopy && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={isCopied ? "Copied" : "Copy"}
          onClick={() => {
            if (!isCopied) copyToClipboard(textToCopy);
          }}
          className={cn(
            // Aligned with the block's py-3/px-4 padding; size-5 keeps the
            // button inside the first line's box.
            "text-muted-foreground hover:text-foreground absolute top-2 right-2.5 size-5 p-1 active:scale-90",
            "opacity-0 transition-opacity duration-150",
            "group-hover/code-block:opacity-100 focus-visible:opacity-100",
            isCopied && "opacity-100",
          )}
        >
          {isCopied ? (
            <CheckIcon className="animate-in zoom-in-50 fade-in size-3 duration-200 ease-out" />
          ) : (
            <CopyIcon className="animate-in zoom-in-75 fade-in size-3 duration-150" />
          )}
        </Button>
      )}
    </div>
  );
}
