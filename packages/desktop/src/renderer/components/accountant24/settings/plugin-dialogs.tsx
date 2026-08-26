// Installing a plugin picked from the marketplace, and uninstalling one — both
// as dialogs on top of Settings.
//
// The install dialog repeats the marketplace row the user clicked — the same
// name, badge, repository and description, drawn the same way — and only
// reaches the network when they commit. Nothing is copied (and nothing from
// the repository runs) before that.

import { CheckIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppDialogHeader } from "@/components/accountant24/app-dialog-header";
import { ExternalLink } from "@/components/accountant24/external-link";
import { Button } from "@/components/shadcn/button";
import { Dialog, DialogContent, DialogFooter, DialogOverlay, DialogPortal } from "@/components/shadcn/dialog";
import { Spinner } from "@/components/shadcn/spinner";
import { pluginsApi } from "@/rpc/api";
import type { MarketplaceEntry } from "@/rpc/types";
import { ErrorBanner, WarningBanner } from "./parts";
import { PluginIdentity, pluginDescription } from "./plugin-row-parts";

/** Base UI skips a nested dialog's backdrop by default (see provider-dialogs);
 *  force one so the Settings surface dims behind this dialog too. */
function NestedDialogBackdrop() {
  return (
    <DialogPortal>
      <DialogOverlay forceRender />
    </DialogPortal>
  );
}

/** The last non-null value: a dialog's content must stay in the tree while the
 *  close transition plays out (the provider-dialogs useLastProvider rule). */
function useLastValue<T>(value: T | null): T | null {
  const last = useRef(value);
  if (value) last.current = value;
  return value ?? last.current;
}

// ---- Uninstall confirmation ----------------------------------------------

export function RemovePluginDialog({
  plugin,
  onClose,
  onRemove,
}: {
  /** The plugin pending removal, or null when the dialog is closed. */
  plugin: string | null;
  onClose: () => void;
  onRemove: (name: string) => void | Promise<void>;
}) {
  const shown = useLastValue(plugin);
  return (
    <Dialog open={plugin !== null} onOpenChange={(next) => !next && onClose()}>
      <NestedDialogBackdrop />
      {/* Keyed so the busy state resets when a different plugin is picked. */}
      {shown && <RemovePluginBody key={shown} name={shown} onClose={onClose} onRemove={onRemove} />}
    </Dialog>
  );
}

function RemovePluginBody({
  name,
  onClose,
  onRemove,
}: {
  name: string;
  onClose: () => void;
  onRemove: (name: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      // Failures surface in the page's error banner; the dialog just closes.
      await onRemove(name);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent showCloseButton={false} className="flex flex-col gap-0 overflow-hidden p-0">
      <AppDialogHeader title="Uninstall plugin?" />
      <div className="p-6">
        <p className="text-muted-foreground text-sm">The plugin folder will be removed from your workspace.</p>
      </div>
      <DialogFooter className="border-t px-6 py-4">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={confirm} disabled={busy}>
          {busy && <Spinner />}
          {busy ? "Uninstalling…" : "Uninstall"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---- Install -------------------------------------------------------------

export function InstallPluginDialog({
  entry,
  onClose,
  onInstalled,
}: {
  /** The marketplace plugin being installed, or null when the dialog is closed. */
  entry: MarketplaceEntry | null;
  onClose: () => void;
  onInstalled: () => void | Promise<void>;
}) {
  const shown = useLastValue(entry);
  return (
    <Dialog open={entry !== null} onOpenChange={(next) => !next && onClose()}>
      <NestedDialogBackdrop />
      {/* The form stays MOUNTED across open/close (resetting itself on each
          opening): unmounting it on close would strand the dialog mid-close
          and leave the forced backdrop up forever — the same rule as
          provider-dialogs' useLastProvider. */}
      {shown && <InstallPluginForm open={entry !== null} entry={shown} onClose={onClose} onInstalled={onInstalled} />}
    </Dialog>
  );
}

function InstallPluginForm({
  open,
  entry,
  onClose,
  onInstalled,
}: {
  open: boolean;
  entry: MarketplaceEntry;
  onClose: () => void;
  onInstalled: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  // What the dialog is showing right now. The form stays mounted across
  // open/close, so an install that is still running when the user cancels and
  // picks another plugin would otherwise keep writing into (and closing) the
  // dialog that plugin opened.
  const shown = useRef(entry);
  shown.current = entry;

  // Fresh form per opening (a keyed remount would unmount mid-close; a plain
  // effect would flash the previous install's state for one frame).
  useLayoutEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
    setProgress([]);
  }, [open]);

  // Progress lines stream from main while the download runs.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    pluginsApi
      .onEvent((event) => {
        if (event.type === "progress") setProgress((lines) => [...lines, event.message]);
      })
      .then((u) => {
        if (cancelled) u();
        else unsub = u;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // Nothing is downloaded until this point: the dialog shows what the
  // marketplace already published, and Install is what goes to the network.
  // Reading the repository and copying it in are one step for the user, two
  // for main — the copy is the very tree that was just read and checked.
  const install = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setProgress([]);
    // The plugin this run is for. Anything that comes back after the dialog
    // has moved on belongs to a cancelled install: it is dropped, and nothing
    // is copied into the store.
    const target = entry;
    const cancelled = () => shown.current !== target;
    try {
      const inspected = await pluginsApi.inspect({ source: target.repo });
      if (cancelled()) return;
      if (inspected.type !== "plugin") throw new Error(inspected.message ?? "Failed to read the plugin");
      // What the dialog showed came from the index, which is rebuilt every
      // half hour and cached for minutes after that; what would be installed
      // is the manifest just read out of the repository. A repository renamed
      // since the last rebuild would install a plugin the user never approved,
      // so the mismatch stops here rather than being copied in.
      if (inspected.plugin.name !== target.name) {
        throw new Error(
          `${target.repo} now holds a plugin named ${inspected.plugin.name}, not ${target.name}. Refresh the marketplace and try again.`,
        );
      }
      const added = await pluginsApi.add();
      if (cancelled()) return;
      if (added.type === "error") throw new Error(added.message ?? "Failed to install the plugin");
      await onInstalled();
      onClose();
    } catch (e) {
      if (cancelled()) return;
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <DialogContent showCloseButton={false} className="flex flex-col gap-0 overflow-hidden p-0">
      <AppDialogHeader title="Install plugin?" />
      <div className="flex flex-col gap-4 p-6">
        {/* The row the user just clicked, drawn by the same component. */}
        <PluginIdentity
          name={entry.name}
          version={entry.version}
          official={entry.official}
          repo={{ label: entry.repo, url: entry.repoUrl }}
          description={pluginDescription(entry)}
        />

        {progress.length > 0 && (
          <div className="flex flex-col gap-2 text-sm">
            {progress.map((line, i) => {
              const current = busy && i === progress.length - 1;
              return (
                <div key={`${i}-${line}`} className="flex items-start gap-2">
                  {current ? (
                    <Spinner className="text-muted-foreground mt-0.5 shrink-0" />
                  ) : (
                    <CheckIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  )}
                  <span className={current ? undefined : "text-muted-foreground"}>{line}</span>
                </div>
              );
            })}
          </div>
        )}
        {error && <ErrorBanner message={error} />}

        {/* Next to the button that accepts what it says. Official plugins are
            ours, so "not reviewed" would be false for them. */}
        {!entry.official && (
          <WarningBanner title="Not reviewed by Accountant24">
            The plugin can read and change your financial data, and run commands on your computer. Look through the
            plugin repository before you install it.{" "}
            <ExternalLink href="https://accountant24.ai/docs/marketplace#install-only-plugins-you-trust">
              Learn more
            </ExternalLink>
          </WarningBanner>
        )}
      </div>
      <DialogFooter className="border-t px-6 py-4">
        {/* No autofocus on either button: the dialog itself takes focus, so a
            stray Enter neither installs nor cancels. */}
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={install} disabled={busy}>
          {busy && <Spinner />}
          {busy ? "Installing…" : "Install"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
