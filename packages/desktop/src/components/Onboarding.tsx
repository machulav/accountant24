// First-run onboarding screen, shown by App in place of the whole chat layout
// while no model is available (fresh install, or every provider removed). It
// orients a brand-new user — what the app does — and presents the three real
// ways to get a model. Every option opens its own Settings dialog on the
// Providers section, where each flow (subscription OAuth, API key, Ollama) is
// implemented; App swaps to the chat on its own the moment the first model
// lands (via the models-changed event the useHasModels hook listens to).

import { KeyRound, Laptop, LogIn } from "lucide-react";
import { type ComponentType, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Settings } from "./settings/Settings";

export function Onboarding() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const onConnect = () => setSettingsOpen(true);
  return (
    <div className="relative h-dvh overflow-y-auto">
      {/* drag strip so the frameless window can still be moved by its top edge */}
      <div className="app-drag-region absolute inset-x-0 top-0 z-20 h-7" />
      <div className="animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none flex min-h-full flex-col px-6 pt-12 pb-4 duration-500">
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8">
          <header className="flex flex-col gap-3 text-center">
            <div className="text-muted-foreground text-sm font-medium tracking-tight">Accountant24</div>
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Local-first AI agent for personal finance
            </h1>
            <p className="text-muted-foreground text-sm text-pretty">
              Log spending, import statements, and ask anything about your finances. Your data stays in plain-text files
              on your device.
            </p>
          </header>

          <div className="flex flex-col gap-2.5">
            <OptionCard
              icon={LogIn}
              title="Sign in with a subscription"
              subtitle="ChatGPT · Claude · more"
              recommended
              onClick={onConnect}
            />
            <OptionCard
              icon={KeyRound}
              title="Use an API key"
              subtitle="Anthropic · OpenAI · Google · more"
              onClick={onConnect}
            />
            <OptionCard
              icon={Laptop}
              title="Connect Ollama"
              subtitle="Run local models · free and fully offline"
              onClick={onConnect}
            />
          </div>
        </div>

        <p className="text-muted-foreground/70 mx-auto max-w-xl pt-8 text-center text-xs text-pretty">
          We collect anonymous analytics to improve Accountant24. Your personal or financial data is never sent. You can
          turn this off any time in Settings → Privacy.
        </p>
      </div>
      <Settings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function OptionCard({
  icon: Icon,
  title,
  subtitle,
  recommended = false,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={recommended ? "default" : "outline"}
      onClick={onClick}
      className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-3 text-left whitespace-normal"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          recommended ? "bg-primary-foreground/15" : "bg-muted",
        )}
      >
        <Icon />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span
          className={cn("block truncate text-xs", recommended ? "text-primary-foreground/70" : "text-muted-foreground")}
        >
          {subtitle}
        </span>
      </span>
    </Button>
  );
}
