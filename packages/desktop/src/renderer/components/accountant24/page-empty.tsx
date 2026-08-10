// The dedicated empty view shared by the full-page views (Transactions,
// Net Worth): the stock shadcn Empty — icon, title, one-line description —
// vertically centered in the page body. Rendered directly inside the page's
// scroll container, in place of the content it stands in for.

import type { FC } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/shadcn/empty";

export const PageEmpty: FC<{
  icon: FC<{ className?: string }>;
  title: string;
  description: string;
}> = ({ icon: Icon, title, description }) => (
  // min-h-full (not h-full): Empty is flex-1, so the column centers it in
  // the body's height; a window too short to fit it grows the column past
  // 100% and scrolls instead of clipping the top. The pb-12 biases the
  // block just above true center (optical center).
  <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col pb-12">
    <Empty>
      <EmptyHeader>
        {/* rounded-full: the app's icon-medallion idiom is a circle on
            bg-muted (see onboarding's OptionCard), not the stock rounded-xl. */}
        <EmptyMedia variant="icon" className="rounded-full">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </div>
);
