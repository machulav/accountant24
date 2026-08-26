// The marketplace: every plugin published to the Accountant24 index, listed so
// one can be installed without leaving the app.
//
// The index is fetched (and cached) by main; this section only lists it. A row
// installs through the same dialog as a hand-typed repository, so what the user
// approves is identical either way. Whether an entry is already installed is
// derived from the plugins list the page holds, so rows flip to "Installed" as
// soon as that list reloads.

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "@/components/accountant24/external-link";
import { SearchField } from "@/components/accountant24/search-field";
import { Button } from "@/components/shadcn/button";
import { ItemActions } from "@/components/shadcn/item";
import { Spinner } from "@/components/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { trackMarketplaceViewed, trackPluginInstallStarted } from "@/lib/analyticsEvents";
import { filterMarketplace, isInstalled, sortMarketplace } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { pluginsApi } from "@/rpc/api";
import type { MarketplaceEntry, PluginInfo } from "@/rpc/types";
import { ErrorBanner, Section, SettingsEmpty, SettingsRow, SettingsRows } from "./parts";
import { InstallPluginDialog } from "./plugin-dialogs";
import { PluginIdentity, pluginDescription } from "./plugin-row-parts";

/** How long the refresh keeps spinning, however fast the answer arrives. Short
 *  enough not to hold anyone up, long enough to register as a refresh. */
const MIN_REFRESH_MS = 500;

/** Wait out whatever is left of the minimum. */
const settle = (startedAt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_REFRESH_MS - (Date.now() - startedAt))));

/** The action column. A plugin the user already has is not listed here at all,
 *  so the only action is installing one. */
function InstallAction({
  entry,
  onInstall,
}: {
  entry: MarketplaceEntry;
  onInstall: (entry: MarketplaceEntry) => void;
}) {
  return (
    <>
      {/* Why the button next to it does nothing, kept beside the button rather
          than in the row: a disabled control can't hold a tooltip of its own. */}
      {entry.appTooOld && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Needs Accountant24 v${entry.minAppVersion} or newer. Update the app to install it.`}
                className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center"
              />
            }
          >
            <TriangleAlertIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent>
            Needs Accountant24 v{entry.minAppVersion} or newer. Update the app to install it.
          </TooltipContent>
        </Tooltip>
      )}
      <Button size="sm" variant="outline" className="w-28" disabled={entry.appTooOld} onClick={() => onInstall(entry)}>
        Install
      </Button>
    </>
  );
}

function MarketplaceRow({
  entry,
  onInstall,
}: {
  entry: MarketplaceEntry;
  onInstall: (entry: MarketplaceEntry) => void;
}) {
  return (
    <SettingsRow>
      {/* The repository, which already names its owner, so the manifest's
          author would only repeat it. No skill list either: these skills
          aren't callable until the plugin is installed. */}
      <PluginIdentity
        name={entry.name}
        version={entry.version}
        official={entry.official}
        repo={{ label: entry.repo, url: entry.repoUrl }}
        description={pluginDescription(entry)}
      />
      <ItemActions>
        <InstallAction entry={entry} onInstall={onInstall} />
      </ItemActions>
    </SettingsRow>
  );
}

export function MarketplaceSection({
  plugins,
  onInstalled,
}: {
  /** The plugins already in the workspace, which this list leaves out. */
  plugins: PluginInfo[];
  /** Called after an install lands, so the page can reload and restart the agent. */
  onInstalled: () => void | Promise<void>;
}) {
  // The plugin the install dialog is confirming, straight from the row: the
  // dialog shows what the marketplace published rather than fetching it again.
  const [installing, setInstalling] = useState<MarketplaceEntry | null>(null);
  // Counted where the dialog opens, not where it succeeds, so an install the
  // user thinks better of after reading the warning is counted too.
  const startInstall = useCallback((entry: MarketplaceEntry) => {
    trackPluginInstallStarted(entry.official);
    setInstalling(entry);
  }, []);
  const [entries, setEntries] = useState<MarketplaceEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // A fetch that lands after the dialog closed must not set state.
  const alive = useRef(true);
  // One "viewed" per visit, not per Refresh: the event counts people reaching
  // the marketplace, and a refresh is the same visit.
  const reported = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async (force: boolean) => {
    const startedAt = Date.now();
    setLoading(true);
    setError(null);
    try {
      const result = await pluginsApi.marketplace({ force });
      if (!alive.current) return;
      // A failed refresh keeps whatever was listed before: an offline laptop
      // still shows the last list, with the error above it.
      if (result.type === "ok") {
        setEntries(sortMarketplace(result.plugins));
        if (!reported.current) {
          reported.current = true;
          trackMarketplaceViewed(result.plugins.length);
        }
      } else setError(result.message);
    } catch {
      if (alive.current) setError("Couldn't load the plugin marketplace.");
    } finally {
      // A cached index comes back in a few milliseconds, which would flash the
      // spinning icon too briefly to read as anything. Refreshing on demand
      // holds it long enough to be seen, so the click has a visible answer.
      if (force) await settle(startedAt);
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // What the user already has lives in the Installed list above, so the
  // marketplace only offers what is still missing.
  const onOffer = entries?.filter((entry) => !isInstalled(entry, plugins));
  const filtered = onOffer ? filterMarketplace(onOffer, query) : [];

  return (
    <Section
      title="Marketplace"
      description={
        <>
          Listed automatically from GitHub, not reviewed by Accountant24.{" "}
          <ExternalLink href="https://accountant24.ai/docs/marketplace">How it works</ExternalLink>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <SearchField subject="plugins" value={query} onValueChange={setQuery} className="flex-1" />
        {/* w-28 like the Install buttons in the rows below, so the column of
            controls on the right shares one edge. */}
        <Button size="sm" variant="outline" className="w-28" onClick={() => void load(true)} disabled={loading}>
          {/* The icon spins in place rather than turning into a spinner: the
              button keeps its shape, and the thing that is turning is the same
              thing that was clicked. */}
          <RefreshCwIcon className={cn(loading && "animate-spin motion-reduce:animate-none")} />
          Refresh
        </Button>
      </div>

      {error && (
        <div>
          <ErrorBanner message={error} />
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void load(true)} disabled={loading}>
            Try again
          </Button>
        </div>
      )}

      {entries === null ? (
        loading && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner /> Loading marketplace…
          </div>
        )
      ) : onOffer?.length === 0 ? (
        <SettingsEmpty>
          {entries.length === 0 ? "No plugins published yet." : "Every published plugin is already installed."}
        </SettingsEmpty>
      ) : filtered.length === 0 ? (
        <SettingsEmpty>No plugins match "{query}".</SettingsEmpty>
      ) : (
        <SettingsRows>
          {filtered.map((entry) => (
            <MarketplaceRow key={entry.repo} entry={entry} onInstall={startInstall} />
          ))}
        </SettingsRows>
      )}
      <InstallPluginDialog entry={installing} onClose={() => setInstalling(null)} onInstalled={onInstalled} />
    </Section>
  );
}
