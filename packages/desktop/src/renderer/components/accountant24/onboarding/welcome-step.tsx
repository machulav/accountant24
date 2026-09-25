// Onboarding step 1: a greeting for someone who has just installed the app.
// They came from accountant24.ai or the README, and both open with the same
// pitch, so this page does not repeat it: the wordmark says which app this
// is, one line says what setup involves. One action: Get started.

import { Button } from "@/components/shadcn/button";

/** Each block enters a beat after the one above it, so the page assembles
 *  itself instead of appearing all at once. */
const stagger = (index: number) => ({ animationDelay: `${index * 70}ms` });

const ENTRANCE = "animate-in fade-in slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none duration-500";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <header className={`${ENTRANCE} flex flex-col items-center gap-2 text-center`}>
        {/* The wordmark as the site's header sets it, the greeting in the
            heavy display weight the site's headline uses. */}
        <p className="text-xl font-semibold tracking-tight">Accountant24</p>
        <h1 className="mt-1 text-[2rem] leading-[1.08] font-black tracking-[-0.03em]">Welcome</h1>
      </header>

      <p style={stagger(1)} className={`${ENTRANCE} text-muted-foreground text-center text-pretty`}>
        Connect the AI you'll be talking to and you're in. It takes about a minute.
      </p>

      <Button size="lg" onClick={onNext} style={stagger(2)} className={ENTRANCE}>
        Get started
      </Button>
    </div>
  );
}
