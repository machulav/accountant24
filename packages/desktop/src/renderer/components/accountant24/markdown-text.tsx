"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import { isValidElement, memo, type ReactNode } from "react";
import remarkGfm from "remark-gfm";

import { CodeBlock } from "@/components/accountant24/code-block";
import { DirectivePill } from "@/components/accountant24/directive-chips";
import { MarkdownTable } from "@/components/accountant24/markdown-table";
import { remarkMentions } from "@/lib/remark-mentions";
import { cn } from "@/lib/utils";

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm, remarkMentions]}
      className="aui-md"
      components={defaultComponents}
      defer
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

/** Raw source of a fenced block: the pre's child is the rendered <code>
 *  element whose only child is the code string (absent for an empty block). */
const codeText = (node: ReactNode): string => {
  if (typeof node === "string") return node;
  if (isValidElement<{ children?: ReactNode }>(node)) return codeText(node.props.children);
  return "";
};

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn("aui-md-h1 mt-5 mb-2 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn("aui-md-h2 mt-5 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn("aui-md-h3 mt-4 mb-1.5 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn("aui-md-h4 mt-3.5 mb-1 scroll-m-20 text-base font-medium first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5 className={cn("aui-md-h5 mt-3 mb-1 text-sm font-semibold first:mt-0 last:mb-0", className)} {...props} />
  ),
  h6: ({ className, ...props }) => (
    <h6 className={cn("aui-md-h6 mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0", className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("aui-md-p my-chat-rhythm leading-relaxed first:mt-0 last:mb-0", className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn("aui-md-a text-primary hover:text-primary/80 underline underline-offset-2", className)}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-chat-rhythm border-s-2 ps-4",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn("aui-md-ul marker:text-muted-foreground my-chat-rhythm ms-5 list-disc [&>li]:mt-1", className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn("aui-md-ol marker:text-muted-foreground my-chat-rhythm ms-5 list-decimal [&>li]:mt-1", className)}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn("aui-md-hr border-muted-foreground/20 my-chat-rhythm", className)} {...props} />
  ),
  table: MarkdownTable,
  th: ({ className, ...props }) => (
    <th
      className={cn(
        // bg-input/50: the shared "surface" token (composer, user bubbles,
        // code blocks) so tables read as the same family.
        // max-w-72 caps prose columns at a readable measure so long text wraps
        // instead of stretching the (w-max) table indefinitely. first:max-w-none
        // exempts the identity column, whose non-wrapping mention chips would
        // otherwise overflow into the next column.
        "aui-md-th bg-input/50 max-w-72 px-3 py-1.5 text-start font-medium first:max-w-none first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-input/50 max-w-72 border-s border-b px-3 py-1.5 text-start align-top first:max-w-none last:border-e [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        "aui-md-tr border-input/50 m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => <li className={cn("aui-md-li leading-relaxed", className)} {...props} />,
  strong: ({ className, ...props }) => <strong className={cn("aui-md-strong font-semibold", className)} {...props} />,
  sup: ({ className, ...props }) => (
    <sup className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)} {...props} />
  ),
  // Headerless code block: the shared CodeBlock surface (hover copy button),
  // restyled for the chat body (full foreground, chat type size).
  pre: ({ className, children, ...props }) => (
    <CodeBlock
      className="my-chat-rhythm first:mt-0 last:mb-0"
      copyText={codeText(children)}
      preClassName={cn("aui-md-pre text-foreground rounded-xl p-3.5 text-[13px]", className)}
      {...props}
    >
      {children}
    </CodeBlock>
  ),
  // Mention directives (`:account[…]` etc.) are rewritten by remarkMentions into
  // `<span data-mention-type data-mention-label>`; render those as the shared
  // chip, and pass every other span through untouched.
  span: ({ className, ...props }) => {
    const type = (props as Record<string, unknown>)["data-mention-type"];
    const label = (props as Record<string, unknown>)["data-mention-label"];
    if (typeof type === "string" && typeof label === "string") {
      return <DirectivePill type={type} label={label} />;
    }
    return <span className={className} {...props} />;
  },
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock && "aui-md-inline-code bg-input/50 rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
});
