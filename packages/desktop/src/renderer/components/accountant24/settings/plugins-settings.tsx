// Plugins — what the chat agent can do. Every plugin lives in the workspace
// store (<workspace>/plugins), including the ones the app ships with, which
// are copied there on first run, and everything else comes from the
// marketplace. Installed means active; uninstalling is how
// one is turned off, and that goes for the app's own plugins too. A row says
// what a plugin is and where it came from; its skills are the agent's
// business, and the composer's `/` picker is where they are listed. The agent
// child is restarted after any change so its skill set matches. Mirrors the
// Providers/Models pages: same sections, rows, badges, and busy patterns.

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { ItemActions } from "@/components/shadcn/item";
import { Spinner } from "@/components/shadcn/spinner";
import { usePluginsStoreChanged } from "@/hooks/use-plugins-store-changed";
import { isOfficial, pluginRepo } from "@/lib/pluginRepo";
import { agentApi, pluginsApi } from "@/rpc/api";
import type { PluginInfo, PluginsList } from "@/rpc/types";
import { MarketplaceSection } from "./marketplace-section";
import { ErrorBanner, Section, SettingsRow, SettingsRows } from "./parts";
import { RemovePluginDialog } from "./plugin-dialogs";
import { PluginIdentity, PluginWarning, pluginDescription } from "./plugin-row-parts";

// ---- Installed ---------------------------------------------------------------

/** Why part of a plugin isn't working: another plugin already claims one of
 *  its skill names, so that skill is inactive. The row lists no skills, but a
 *  skill that silently does nothing has to say so. */
function SkillConflicts({ plugin }: { plugin: PluginInfo }) {
  const clashes = plugin.skills.filter((skill) => skill.error);
  if (clashes.length === 0) return null;
  return (
    <>
      {clashes.map((skill) => (
        <PluginWarning key={skill.name}>
          <code className="font-mono">{skill.name}</code> {skill.error}
        </PluginWarning>
      ))}
    </>
  );
}

function InstalledPluginRow({
  plugin,
  onRemove,
}: {
  plugin: PluginInfo;
  /** Opens the uninstall confirmation; the dialog owns the busy state. */
  onRemove: () => void;
}) {
  const repo = pluginRepo(plugin);

  return (
    <SettingsRow>
      <PluginIdentity
        name={plugin.name}
        official={isOfficial(plugin)}
        repo={repo}
        description={plugin.error ?? pluginDescription(plugin)}
        badges={
          <>
            {!repo && <Badge variant="secondary">Manual</Badge>}
            {plugin.error && <Badge variant="destructive">Invalid</Badge>}
          </>
        }
      >
        {!plugin.error && <SkillConflicts plugin={plugin} />}
      </PluginIdentity>
      <ItemActions>
        <Button size="sm" variant="outline" className="w-28" onClick={onRemove}>
          Uninstall
        </Button>
      </ItemActions>
    </SettingsRow>
  );
}

// ---- Page --------------------------------------------------------------------

export function PluginsSettings() {
  const [plugins, setPlugins] = useState<PluginsList | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // A list that resolves after the page is gone must not set state.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const next = await pluginsApi.list();
    if (alive.current) setPlugins(next);
  }, []);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  // The default plugins can land while this page is open (a first launch that
  // only just reached the network), so the list follows main rather than the
  // last thing the user did here.
  const reloadQuietly = useCallback(() => {
    reload().catch(() => undefined);
  }, [reload]);
  usePluginsStoreChanged(reloadQuietly);

  // Install/remove change what the agent sees, so restart it (it caches skills
  // at startup) — the providers afterAdd pattern.
  const afterChange = useCallback(async () => {
    await agentApi.restart();
    await reload();
  }, [reload]);

  const remove = useCallback(
    async (name: string) => {
      setSaveError(null);
      try {
        const result = await pluginsApi.remove(name);
        if (result.type === "error") throw new Error(result.message ?? "Failed to remove plugin");
        await afterChange();
      } catch (e) {
        setSaveError(String(e));
      }
    },
    [afterChange],
  );

  if (!plugins) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
        <Spinner /> Loading plugins…
      </div>
    );
  }

  // One list, by name: which plugins came with the app and which were added is
  // a property of a row, not a reason to split the page.
  const installed = [...plugins.plugins].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  return (
    <div>
      {saveError && (
        <div className="px-6 pt-5">
          <ErrorBanner message={saveError} />
        </div>
      )}

      {installed.length > 0 && (
        <Section title="Installed" description="Installed plugins.">
          <SettingsRows>
            {installed.map((plugin) => (
              <InstalledPluginRow key={plugin.name} plugin={plugin} onRemove={() => setRemoveTarget(plugin.name)} />
            ))}
          </SettingsRows>
        </Section>
      )}

      <MarketplaceSection plugins={plugins.plugins} onInstalled={afterChange} />
      <RemovePluginDialog plugin={removeTarget} onClose={() => setRemoveTarget(null)} onRemove={remove} />
    </div>
  );
}
