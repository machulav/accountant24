// Small building blocks shared across the Settings pages.

import { AlertCircleIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/shadcn/alert";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/shadcn/field";
import { Item, ItemGroup } from "@/components/shadcn/item";
import { cn } from "@/lib/utils";

export function Section({
  title,
  description,
  children,
}: {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // Stock FieldSet spacing is form-scale (gap-6, legend mb-3), which reads as
    // disconnected on a dense settings page. Group title+description into one
    // header block (2px apart) with the content a compact 16px below.
    // min-w-0: a fieldset's UA default is min-inline-size:min-content, which
    // blocks shrinking below the widest row and causes horizontal overflow.
    <FieldSet className="min-w-0 gap-4 border-b px-6 py-5 last:border-b-0">
      {(title || description) && (
        <div>
          {title && (
            <FieldLegend variant="label" className="mb-0.5">
              {title}
            </FieldLegend>
          )}
          {description && (
            <FieldDescription className="text-xs">
              {/* The span keeps the description's links out of reach of stock
                  FieldDescription's `[&>a]` rules (always underlined, primary on
                  hover), which are direct-child only. Links here come from
                  ExternalLink and bring their own look, the same one they have
                  in the rows below. */}
              <span>{description}</span>
            </FieldDescription>
          )}
        </div>
      )}
      {children}
    </FieldSet>
  );
}

/** A list of settings rows. Stock ItemGroup gaps are card-scale; settings
 *  pages use dense lists, so tighten the gap to match. A bare gap-1 isn't
 *  enough: ItemGroup's own has-data-[size=sm]:gap-2.5 variant would still win
 *  over it, so the size-scoped override is needed too. */
export function SettingsRows({ children }: { children: React.ReactNode }) {
  return <ItemGroup className="gap-1 has-data-[size=sm]:gap-1">{children}</ItemGroup>;
}

/** A single settings row. Stock Item spacing is card-scale (padding inside a
 *  border/background); these rows paint neither, so drop the border (it adds
 *  2px of height) and the horizontal padding (it only ragged the left edge
 *  against the section header) and compact the vertical rhythm. Row titles
 *  are plain weight — ItemTitle's medium is card-heading styling; here the
 *  section header is the only heading. flex-nowrap + content min-w-0: on
 *  narrow widths the title must truncate (Item's default is to wrap the
 *  actions onto their own line instead). */
export function SettingsRow({ className, ...props }: React.ComponentProps<typeof Item>) {
  return (
    <Item
      size="sm"
      className={cn(
        "flex-nowrap border-0 px-0 py-1.5 **:data-[slot=item-content]:min-w-0 **:data-[slot=item-title]:font-normal",
        className,
      )}
      {...props}
    />
  );
}

/** A section with nothing in it yet.
 *
 *  Settings sections stay on the page when they are empty: a section that
 *  disappears takes with it the answer to "where do my providers live?", and
 *  the page's shape then changes as the user configures things. So the section
 *  keeps its heading and says, in its place, what will appear here and what to
 *  do to get it.
 *
 *  Deliberately plain: one muted line at row scale, with room for a single
 *  action. The full-page treatment (an icon, a headline, a bordered panel) is
 *  `PageEmpty`; inside a dense settings page that would shout louder than the
 *  filled sections around it. */
export function SettingsEmpty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-1.5">
      <p className="text-muted-foreground text-sm">{children}</p>
      {action}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="mt-3">
      <AlertCircleIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** Something the user should weigh before going ahead. The stock Alert has no
 *  warning variant and its default paints bg-card, the same colour as the
 *  dialog it sits in, so this one is filled in the warning colour: yellow is
 *  what a caution looks like, and it separates the box from the surface. */
export function WarningBanner({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Alert
      className={cn(
        "bg-warning/15 border-warning/40 text-warning-foreground *:data-[slot=alert-description]:text-warning-foreground/90",
        // Stock AlertDescription paints its own link styling over anything a
        // link brings (`[&_a]:underline`, `[&_a]:hover:text-foreground`), which
        // would give ExternalLink a second look inside an alert. These win it
        // back: the alert's colour, and the underline only on hover.
        "[&_a]:text-warning-foreground! [&_a]:no-underline! [&_a:hover]:underline!",
      )}
    >
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
