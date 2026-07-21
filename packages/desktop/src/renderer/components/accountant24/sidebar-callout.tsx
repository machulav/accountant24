// The tinted callout block the sidebar footers share (settings' star-the-repo
// link, chat's update banner): icon in a filled circle, two-line text, trailing
// arrow. Built on the ghost Button so both get its focus/active affordances and
// svg sizing; pass Base UI's `render={<a …/>}` to make it a link.

import { ArrowRightIcon, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/shadcn/button";
import { cn } from "@/lib/utils";

type SidebarCalloutProps = {
  icon: LucideIcon;
  title: ReactNode;
  subtitle: ReactNode;
} & Omit<ComponentProps<typeof Button>, "variant" | "size" | "children">;

export function SidebarCallout({ icon: Icon, title, subtitle, className, ...props }: SidebarCalloutProps) {
  return (
    <Button
      variant="ghost"
      /* h-auto/justify/text-left relax the fixed button metrics to fit the
         two-line content. dark:hover overrides the ghost variant's own
         dark-mode hover color. border-0: the Button's transparent border would
         inset the tinted fill (bg-clip-padding) and eat 2px of the tight text
         column; the focus-visible ring alone marks focus. The --radius bump
         mirrors the settings SidebarFooter override so rounded-xl computes to
         the same radius in both footers (the stock chat SidebarFooter leaves
         --radius at the base value, where rounded-xl is squarer). */
      className={cn(
        "h-auto w-full justify-start gap-2 rounded-xl border-0 [--radius:var(--radius-xl)] bg-primary/10 px-3 py-2.5 text-left hover:bg-primary/15 dark:hover:bg-primary/15",
        className,
      )}
      {...props}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
        <Icon />
      </span>
      <span className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate">{title}</span>
        <span className="truncate font-normal text-muted-foreground text-xs">{subtitle}</span>
      </span>
      <ArrowRightIcon className="text-muted-foreground" />
    </Button>
  );
}
