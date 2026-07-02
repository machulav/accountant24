// Models — choose the default model new chats start with, and which authed
// models you can pick from in chat. The app's analogue of pi's /model and
// /scoped-models, driven entirely through the app.

import { useCallback, useEffect, useMemo, useState } from "react";
import { type ModelOption, ModelSelector } from "@/components/assistant-ui/model-selector";
import { Switch } from "@/components/ui/switch";
import { addEnabledModels } from "../../lib/enabledModels";
import { authApi, settingsApi } from "../../rpc/api";
import type { AppSettings, ModelInfo } from "../../rpc/types";
import { ErrorBanner, Section } from "./parts";

const idOf = (m: { provider: string; id: string }) => `${m.provider}/${m.id}`;

// ---- Default model --------------------------------------------------------

function DefaultModelSection({
  models,
  value,
  onSelect,
}: {
  models: ModelInfo[];
  /** `provider/modelId` id of the current default, or undefined. */
  value: string | undefined;
  onSelect: (id: string) => void;
}) {
  const options: ModelOption[] = useMemo(
    () => models.map((m) => ({ id: idOf(m), name: m.name ?? m.id, description: m.provider })),
    [models],
  );

  if (models.length === 0) {
    return <p className="text-muted-foreground text-sm">Connect a provider to choose a default model.</p>;
  }

  return (
    // ModelSelector.Root (not the default-export ModelSelector) so we don't
    // register a model with assistant-ui's ModelContext — that belongs to the
    // composer, not to Settings.
    <ModelSelector.Root models={options} modal {...(value !== undefined ? { value } : {})} onValueChange={onSelect}>
      <ModelSelector.Trigger variant="outline" className="w-72" />
      <ModelSelector.Content className="w-72">
        <ModelSelector.Search />
        <ModelSelector.List />
      </ModelSelector.Content>
    </ModelSelector.Root>
  );
}

// ---- Enabled / Available models -------------------------------------------

const modelName = (m: ModelInfo) => m.name ?? m.id;

function ModelRow({
  model: m,
  isDefault,
  checked,
  onToggle,
}: {
  model: ModelInfo;
  isDefault: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const switchId = `enabled-model-${idOf(m)}`;
  return (
    // The label must NOT wrap the Switch: a Radix Switch (a button + hidden
    // form input) inside a wrapping label double-fires and cancels the
    // toggle. Point at it with htmlFor instead.
    <div className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
      <label htmlFor={switchId} className="min-w-0 cursor-pointer">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm">{modelName(m)}</span>
          {isDefault && (
            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs">Default</span>
          )}
        </span>
        <span className="text-muted-foreground block truncate text-xs">{m.provider}</span>
      </label>
      <Switch id={switchId} checked={checked} disabled={isDefault} onCheckedChange={onToggle} />
    </div>
  );
}

function ModelToggleSections({
  models,
  settings,
  defaultId,
  onChange,
}: {
  models: ModelInfo[];
  settings: AppSettings;
  /** `provider/modelId` of the default model — always enabled, can't be hidden. */
  defaultId: string | undefined;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const allIds = useMemo(() => models.map(idOf), [models]);
  const selected = settings.enabledModels ?? [];
  const showingAll = selected.length === 0;
  const enabled = useMemo(() => (showingAll ? new Set(allIds) : new Set(selected)), [showingAll, allIds, selected]);

  const toggle = (id: string) => {
    if (id === defaultId) return; // the default is locked on — change it first
    const next = new Set(enabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (next.size === 0) return; // never hide every model
    // Store [] when everything is on (so newly added models show by default),
    // otherwise the explicit allow-list.
    const list = allIds.every((i) => next.has(i)) ? [] : allIds.filter((i) => next.has(i));
    onChange({ enabledModels: list });
  };

  if (models.length === 0) {
    return (
      <Section title="Enabled" description="Shown in the chat model selector.">
        <p className="text-muted-foreground text-sm">Connect a provider to choose which models appear.</p>
      </Section>
    );
  }

  // Split into enabled vs available, each sorted A→Z by display name. The default
  // is always counted as enabled.
  const byName = (a: ModelInfo, b: ModelInfo) => modelName(a).localeCompare(modelName(b));
  const isOn = (m: ModelInfo) => idOf(m) === defaultId || enabled.has(idOf(m));
  const enabledModels = models.filter(isOn).sort(byName);
  const availableModels = models.filter((m) => !isOn(m)).sort(byName);

  const renderRow = (m: ModelInfo) => {
    const id = idOf(m);
    const isDefault = id === defaultId;
    return (
      <ModelRow
        key={id}
        model={m}
        isDefault={isDefault}
        checked={isDefault || enabled.has(id)}
        onToggle={() => toggle(id)}
      />
    );
  };

  return (
    <>
      {enabledModels.length > 0 && (
        <Section title="Enabled" description="Shown in the chat model selector.">
          <div className="flex flex-col gap-1">{enabledModels.map(renderRow)}</div>
        </Section>
      )}
      {availableModels.length > 0 && (
        <Section title="Available" description="Enable to show in the chat model selector.">
          <div className="flex flex-col gap-1">{availableModels.map(renderRow)}</div>
        </Section>
      )}
    </>
  );
}

// ---- Page -----------------------------------------------------------------

export function ModelsSettings() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    authApi
      .models()
      .then((m) => setModels(m.models))
      .catch(() => undefined);
    settingsApi
      .get()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  const patch = useCallback((p: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...p }));
    setSaveError(null);
    settingsApi
      .set(p)
      .catch((e) => setSaveError(`Couldn’t save settings: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  // Picking a default also enables it — the default must always be available to
  // new chats.
  const setDefault = useCallback(
    (id: string) => {
      const current = settings.enabledModels;
      if (current && current.length > 0 && !current.includes(id)) {
        const allIds = models.map(idOf);
        patch({ defaultModel: id, enabledModels: addEnabledModels(current, [id], allIds) });
      } else {
        patch({ defaultModel: id });
      }
    },
    [models, settings.enabledModels, patch],
  );

  const defaultId = settings.defaultModel;

  return (
    <div>
      {saveError && (
        <div className="px-6 pt-5">
          <ErrorBanner message={saveError} />
        </div>
      )}
      <Section title="Default model" description="The model new chats start with.">
        <DefaultModelSection models={models} value={settings.defaultModel} onSelect={setDefault} />
      </Section>
      <ModelToggleSections models={models} settings={settings} defaultId={defaultId} onChange={patch} />
    </div>
  );
}
