// Small building blocks shared across the Settings pages.

import { AlertCircleIcon, ExternalLinkIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/shadcn/alert";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/shadcn/field";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/shadcn/item";
import { cn } from "@/lib/utils";

export function Section({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  /** Optional: a section may be prose only (a note with no rows). */
  children?: React.ReactNode;
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
          {description && <FieldDescription className="text-xs">{description}</FieldDescription>}
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

/** A whole-row external link (the Item renders as an anchor, so the stock
 *  `[a]:hover:bg-muted` affordance applies). SettingsRow strips horizontal
 *  padding to align text with the section header; for an interactive row the
 *  hover bg would then hug the text, so restore padding and pull it back out
 *  with a negative margin (the shadcn menu-item idiom), and swap the stock
 *  rounded-2xl (a pill at this row height) for the rounded-xl the app's other
 *  interactive rows use (sidebar nav, dropdown items). */
export function LinkRow({ label, href }: { label: string; href: string }) {
  return (
    // biome-ignore lint/a11y/useAnchorContent: useRender injects the row children (incl. the title) into the anchor at runtime
    <SettingsRow className="-mx-2 w-auto rounded-xl px-2" render={<a href={href} target="_blank" rel="noreferrer" />}>
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
      </ItemContent>
      <ItemActions>
        <ExternalLinkIcon className="text-muted-foreground size-4" />
      </ItemActions>
    </SettingsRow>
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
