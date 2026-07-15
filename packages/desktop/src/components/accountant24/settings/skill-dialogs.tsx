// Add a skill from any public GitHub repository — a dialog on top of
// Settings, shaped like the provider ApiKeyDialog: one input, busy/error
// handling, and streamed progress lines while the add runs.

import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppDialogHeader } from "@/components/accountant24/app-dialog-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/shadcn/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
} from "@/components/shadcn/alert-dialog";
import { Button } from "@/components/shadcn/button";
import { Dialog, DialogContent, DialogFooter, DialogOverlay, DialogPortal } from "@/components/shadcn/dialog";
import { Field, FieldLabel } from "@/components/shadcn/field";
import { Input } from "@/components/shadcn/input";
import { Spinner } from "@/components/shadcn/spinner";
import { cn } from "@/lib/utils";
import { skillsApi } from "@/rpc/api";
import { ErrorBanner } from "./parts";

/** Base UI skips a nested dialog's backdrop by default (see provider-dialogs);
 *  force one so the Settings surface dims behind this dialog too. */
function NestedDialogBackdrop() {
  return (
    <DialogPortal>
      <DialogOverlay forceRender />
    </DialogPortal>
  );
}

/** The alert-dialog twin of NestedDialogBackdrop. */
function NestedAlertDialogBackdrop() {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay forceRender />
    </AlertDialogPortal>
  );
}

// ---- Remove confirmation -------------------------------------------------

/** The last non-null skill name: the content must stay in the tree while the
 *  close transition plays out (the provider-dialogs useLastProvider rule). */
function useLastSkillName(name: string | null): string | null {
  const last = useRef(name);
  if (name) last.current = name;
  return name ?? last.current;
}

export function RemoveSkillDialog({
  skill,
  onClose,
  onRemove,
}: {
  /** The skill pending removal, or null when the dialog is closed. */
  skill: string | null;
  onClose: () => void;
  onRemove: (name: string) => void | Promise<void>;
}) {
  const shown = useLastSkillName(skill);
  return (
    <AlertDialog open={skill !== null} onOpenChange={(next) => !next && onClose()}>
      <NestedAlertDialogBackdrop />
      {/* Keyed so the busy state resets when a different skill is picked. */}
      {shown && <RemoveSkillBody key={shown} name={shown} onClose={onClose} onRemove={onRemove} />}
    </AlertDialog>
  );
}

function RemoveSkillBody({
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
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
        <AlertDialogDescription>The skill folder will be removed from your workspace.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={confirm} disabled={busy}>
          {busy && <Spinner />}
          {busy ? "Removing…" : "Remove"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

export function AddSkillDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <NestedDialogBackdrop />
      {/* The form stays MOUNTED across open/close (resetting itself on each
          opening): unmounting it on close would strand the dialog mid-close
          and leave the forced backdrop up forever — the same rule as
          provider-dialogs' useLastProvider. */}
      <AddSkillForm open={open} onClose={onClose} onAdded={onAdded} />
    </Dialog>
  );
}

function AddSkillForm({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);

  // Fresh form per opening (a keyed remount would unmount mid-close; a plain
  // effect would flash the previous add's state for one frame).
  useLayoutEffect(() => {
    if (!open) return;
    setUrl("");
    setBusy(false);
    setError(null);
    setProgress([]);
  }, [open]);

  // Progress lines stream from main while the add runs.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    skillsApi
      .onEvent((event) => setProgress((lines) => [...lines, event.message]))
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

  const submit = async () => {
    // The busy guard also covers Enter on the input.
    if (busy || !url.trim()) return;
    setBusy(true);
    setError(null);
    setProgress([]);
    try {
      const result = await skillsApi.add({ source: url.trim() });
      if (result.type === "error") throw new Error(result.message ?? "Failed to add skill");
      await onAdded();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <DialogContent showCloseButton={false} className="flex flex-col gap-0 overflow-hidden p-0">
      <AppDialogHeader title="Add skills from GitHub repository" />
      <div className="flex flex-col gap-6 p-6">
        {/* The trust warning as a stock Alert restyled as a warning callout:
          borderless soft-yellow fill with amber text and icon (the standard
          warning treatment). The theme has no warning token, so amber is
          hardcoded with dark-mode variants (the SkillPill precedent). */}
        <Alert
          className={cn(
            "border-none bg-amber-100/70 text-amber-900 *:data-[slot=alert-description]:text-amber-900/80",
            "dark:bg-amber-400/15 dark:text-amber-200 dark:*:data-[slot=alert-description]:text-amber-200/80",
          )}
        >
          <TriangleAlertIcon />
          <AlertTitle>Only add skills you trust</AlertTitle>
          <AlertDescription>Skills can run commands with full access to your workspace.</AlertDescription>
        </Alert>
        <Field>
          <FieldLabel htmlFor="skill-repo-url">GitHub repository</FieldLabel>
          <Input
            id="skill-repo-url"
            value={url}
            placeholder="owner/repo or https://github.com/owner/repo"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          {progress.length > 0 && (
            <div className="flex flex-col gap-2 pt-1">
              {progress.map((line, i) => {
                const current = busy && i === progress.length - 1;
                return (
                  <div key={`${i}-${line}`} className="flex items-start gap-2 text-sm">
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
        </Field>
      </div>
      <DialogFooter className="border-t px-6 py-4">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy || !url.trim()}>
          {busy && <Spinner />}
          {busy ? "Adding…" : "Add skill"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
