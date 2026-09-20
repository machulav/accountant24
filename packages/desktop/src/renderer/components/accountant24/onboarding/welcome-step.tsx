// Onboarding step 1: what the app is, in the landing page's own words
// (packages/website/src/content/site.ts): its three headline actions, each
// described the way the site describes it, so what brought someone here is
// what greets them. One action: Get started.

import { ChartNoAxesCombinedIcon, MessageSquareTextIcon, ReceiptIcon } from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/shadcn/button";

const FEATURES: { icon: ComponentType<{ className?: string }>; title: string; description: string }[] = [
  {
    icon: MessageSquareTextIcon,
    title: "Log spending in plain language",
    description:
      "A plain sentence becomes a proper double-entry transaction in your ledger. The agent fills in the details.",
  },
  {
    icon: ReceiptIcon,
    title: "Import bank statements and receipts",
    description:
      "A PDF bank statement, a CSV export, or a photo of a paper receipt becomes transactions in your ledger.",
  },
  {
    icon: ChartNoAxesCombinedIcon,
    title: "Ask questions about your money",
    description:
      "Ask in plain words and get a straight answer from your own numbers, whether it's one trip, one payee, or the whole year.",
  },
];

/** Each block enters a beat after the one above it, so the page assembles
 *  itself instead of appearing all at once. */
const stagger = (index: number) => ({ animationDelay: `${index * 70}ms` });

const ENTRANCE = "animate-in fade-in slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none duration-500";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <header className={`${ENTRANCE} flex flex-col items-center gap-2 text-center`}>
        {/* The wordmark as the site's header sets it, the headline in the
            heavy display weight, the tagline in the italic serif underneath. */}
        <p className="text-xl font-semibold tracking-tight">Accountant24</p>
        <h1 className="mt-1 text-[2rem] leading-[1.08] font-black tracking-[-0.03em] text-balance">
          Open source AI agent for personal finance
        </h1>
        <p className="text-primary font-serif text-2xl tracking-tight text-pretty italic">
          Runs on your machine, you own the data
        </p>
      </header>

      <div className="flex flex-col gap-5">
        {FEATURES.map((feature, i) => (
          <div key={feature.title} style={stagger(i + 1)} className={`${ENTRANCE} flex items-start gap-3`}>
            <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full">
              <feature.icon className="size-4" />
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="font-medium">{feature.title}</p>
              <p className="text-muted-foreground text-sm text-pretty">{feature.description}</p>
            </div>
          </div>
        ))}
      </div>

      <Button size="lg" onClick={onNext} style={stagger(FEATURES.length + 1)} className={ENTRANCE}>
        Get started
      </Button>
    </div>
  );
}
