// A link that leaves the app for a web page in the system browser.

import { ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Every link out of the app looks the same: muted, underlined on hover, and
 *  ending in the icon that marks a link as leaving the app.
 *
 *  `className` is for the surface, not for a new look: a filled alert passes
 *  its own colour so the link belongs to the alert rather than to the page.
 *  Nothing else is overridden, including the underline, so every link out of
 *  the app reads the same. Size is inherited, to match the text around it. */
export function ExternalLink({
  href,
  title,
  className,
  children,
}: {
  href: string;
  /** Tooltip, for a link whose text alone doesn't say where it goes. */
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={cn(
        "text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1 font-normal underline-offset-3 hover:underline",
        className,
      )}
    >
      {children}
      <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
    </a>
  );
}
