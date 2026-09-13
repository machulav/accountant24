// Onboarding step 1: what the app is, in three lines a new user can act on,
// with the privacy promise that sets it apart. One action: Get started.

import { ChartNoAxesCombinedIcon, LockIcon, MessageSquareTextIcon, ReceiptIcon } from "lucide-react";
import type { ComponentType } from "react";
import icon from "@/assets/icon.png";
import { Button } from "@/components/shadcn/button";

const FEATURES: { icon: ComponentType<{ className?: string }>; title: string; description: string }[] = [
  {
    icon: MessageSquareTextIcon,
    title: "Log spending in plain language",
    description: "Say what you spent. It becomes a proper entry in your ledger.",
  },
  {
    icon: ReceiptIcon,
    title: "Import statements and receipts",
    description: "Drop a PDF or a photo. Every transaction is pulled out and added.",
  },
  {
    icon: ChartNoAxesCombinedIcon,
    title: "Ask anything about your money",
    description: "Answers come from your own ledger, not from a cloud account.",
  },
];

/** Each block enters a beat after the one above it, so the page assembles
 *  itself instead of appearing all at once. */
const stagger = (index: number) => ({ animationDelay: `${index * 70}ms` });

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <header className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none flex flex-col items-center gap-3 text-center duration-500">
        <img src={icon} alt="" draggable={false} className="size-14" />
        <h1 className="text-3xl font-semibold tracking-tight">Welcome to Accountant24</h1>
        <p className="text-muted-foreground text-pretty">A local-first AI agent for personal finance.</p>
      </header>

      <div className="flex flex-col gap-5">
        {FEATURES.map((feature, i) => (
          <div
            key={feature.title}
            style={stagger(i + 1)}
            className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none flex items-start gap-3 duration-500"
          >
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

      <div
        style={stagger(FEATURES.length + 1)}
        className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none flex flex-col gap-5 duration-500"
      >
        <p className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
          <LockIcon className="size-3.5 shrink-0" />
          Your data stays on this Mac as plain text, versioned with git.
        </p>
        <Button size="lg" onClick={onNext}>
          Get started
        </Button>
      </div>
    </div>
  );
}
