// The end of the connect step: the provider is in, a model has been chosen for
// the user, and the only thing left is to open the app. The choice is stated
// in a sentence; the picker is one click away for anyone who wants another.

import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/shadcn/button";
import { Field, FieldDescription, FieldLabel } from "@/components/shadcn/field";
import { Spinner } from "@/components/shadcn/spinner";
import type { ModelInfo } from "@/rpc/types";
import { DefaultModelSection } from "../settings/models-settings";
import { ErrorBanner } from "../settings/parts";

export function ConnectedPanel({
  providerName,
  models,
  defaultModel,
  onSelectDefault,
  saveError,
  onOpen,
}: {
  providerName: string;
  models: ModelInfo[];
  defaultModel: string | undefined;
  onSelectDefault: (id: string) => void;
  saveError: string | null;
  onOpen: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const chosen = models.find((m) => `${m.provider}/${m.id}` === defaultModel);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col items-center gap-3 text-center">
        <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
          <CheckIcon className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Connected to {providerName}</h1>
        <p className="text-muted-foreground text-sm text-pretty">You can add more providers any time in Settings.</p>
      </header>

      {choosing ? (
        <Field>
          <FieldLabel htmlFor="onboarding-default-model">Default model</FieldLabel>
          {/* The picker is a combobox, not an input, so the label points at the
              section rather than a form control. */}
          <DefaultModelSection models={models} value={defaultModel} onSelect={onSelectDefault} className="w-full" />
          <FieldDescription>The model new chats start with. Change it any time.</FieldDescription>
        </Field>
      ) : chosen ? (
        <p className="text-center text-pretty">
          You'll be talking to <span className="font-medium">{chosen.name ?? chosen.id}</span>.{" "}
          <button
            type="button"
            onClick={() => setChoosing(true)}
            className="text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            Change model
          </button>
        </p>
      ) : (
        // The models arrive a beat after the connect; nothing to change yet.
        <p className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
          <Spinner /> Choosing a model for you
        </p>
      )}
      {saveError && <ErrorBanner message={saveError} />}

      <Button size="lg" onClick={onOpen} disabled={models.length === 0}>
        Open Accountant24
      </Button>
    </div>
  );
}
