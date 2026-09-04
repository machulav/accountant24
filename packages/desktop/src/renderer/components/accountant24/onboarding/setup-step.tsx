// Onboarding step 2: connect a provider and see the model new chats will use.
// The provider list is the Settings → Providers pane itself, embedded in the
// page; connecting there restarts the agent and preselects a default model,
// and the Default model section below follows along (useModelChoice). Start
// is available as soon as one model exists.

import { Button } from "@/components/shadcn/button";
import { DefaultModelSection } from "../settings/models-settings";
import { ErrorBanner, Section } from "../settings/parts";
import { ProvidersSettings } from "../settings/providers-settings";
import { useModelChoice } from "./use-model-choice";

export function SetupStep({ onStart }: { onStart: () => void }) {
  const { models, defaultModel, setDefault, saveError } = useModelChoice();
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-12 pb-6">
        <div className="animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none mx-auto flex w-full max-w-xl flex-col gap-6 duration-500">
          <header className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Connect a provider</h1>
            <p className="text-muted-foreground text-sm text-pretty">
              Sign in with a subscription, paste an API key, or use local models through Ollama. You can add more
              providers later in Settings.
            </p>
          </header>
          {/* The settings sections in one panel. Card's tokens by hand: the
              stock Card adds its own padding on top of the sections' px-6 py-5,
              and the sections' bottom borders are the panel's row dividers. */}
          <div className="bg-card text-card-foreground rounded-xl border shadow-sm">
            <ProvidersSettings />
            <Section
              title="Default model"
              description="The model new chats start with. Picked for you, change it any time."
            >
              <DefaultModelSection models={models} value={defaultModel} onSelect={setDefault} />
              {saveError && <ErrorBanner message={saveError} />}
            </Section>
          </div>
        </div>
      </div>
      {/* Outside the scroller: Start stays in reach however long the list is. */}
      <footer className="flex justify-end border-t px-6 py-4">
        <Button onClick={onStart} disabled={models.length === 0}>
          Start
        </Button>
      </footer>
    </>
  );
}
