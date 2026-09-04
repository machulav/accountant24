// Onboarding step 1: what the app is, shown as its icon, name, one-line
// description, and a looping example exchange in place of a paragraph (the
// use-case showcase). One action: Get started.

import icon from "@/assets/icon.png";
import { Button } from "@/components/shadcn/button";
import { UseCaseShowcase } from "./use-case-showcase";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-12 pb-6">
      <div className="animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-8 duration-500">
        <header className="flex flex-col items-center gap-3 text-center">
          <img src={icon} alt="" draggable={false} className="size-20" />
          <h1 className="text-3xl font-semibold tracking-tight">Accountant24</h1>
          <p className="text-muted-foreground text-sm text-pretty">Local-first AI agent for personal finance.</p>
        </header>
        <UseCaseShowcase />
        <Button size="lg" onClick={onNext}>
          Get started
        </Button>
      </div>
    </div>
  );
}
