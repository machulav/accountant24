// Esc stops the run (the library input ships cancelOnEscape). With the
// morphing action slot, Esc is the way to stop while a draft is typed — but
// the library's own Esc branch clears pi's queue without giving a pending
// steering message's text back. This CRITICAL-priority handler shadows that
// branch (Lexical dispatches highest first) to add exactly one step: restore
// the queued text into the composer before the built-in cancel, the same
// restore the Stop button does. Popover-open Esc still closes the popover
// (plugins first); a non-cancellable state falls through untouched.

import { INTERNAL, useAui } from "@assistant-ui/react";
import { COMMAND_PRIORITY_CRITICAL, KEY_ESCAPE_COMMAND, type LexicalEditor } from "lexical";
import { type RefObject, useEffect } from "react";
import type { SteerEnterPlugin, SteerEnterRegistry } from "@/hooks/use-steer-enter";

type LexicalEditorElement = HTMLElement & { __lexicalEditor?: LexicalEditor };

/** The composer surface the restore/cancel path touches, typed structurally
 *  so tests pass a fake. */
export interface EscapeStopComposer {
  getState(): { canCancel: boolean; text: string; queue: readonly { id: string; prompt: string }[] };
  setText(text: string): void;
  cancel(): void;
}

export interface EscapeStopAui {
  composer(): EscapeStopComposer;
}

/** Give a pending queued (steering) message's text back to the composer.
 *  A typed draft wins: a non-empty composer is never overwritten (the queued
 *  text is dropped with the queue in that case). Shared by the Stop button
 *  and the Esc handler. */
export function restoreQueuedDraft(composer: Pick<EscapeStopComposer, "getState" | "setText">): void {
  const { queue, text } = composer.getState();
  if (queue.length > 0 && !text.trim()) {
    composer.setText(queue.map((q) => q.prompt).join("\n\n"));
  }
}

/** Exported for tests: the KEY_ESCAPE_COMMAND handler body. Mirrors the
 *  library's Esc branch (plugins first, then cancel-if-cancellable) with the
 *  queued-text restore inserted before the cancel. */
export function escapeStopHandler(
  event: KeyboardEvent | null,
  aui: EscapeStopAui,
  plugins: readonly SteerEnterPlugin[],
): boolean {
  if (event) {
    for (const plugin of plugins) {
      if (plugin.handleKeyDown(event)) return true;
    }
  }
  const composer = aui.composer();
  if (!composer.getState().canCancel) return false;
  restoreQueuedDraft(composer);
  composer.cancel();
  event?.preventDefault();
  return true;
}

/** Build the Lexical command listener (exported for tests). The plugin list is
 *  read per keypress, not at registration, so popovers opened later count. */
export const makeEscapeStopListener =
  (aui: EscapeStopAui, registry: SteerEnterRegistry | null) =>
  (event: KeyboardEvent | null): boolean =>
    escapeStopHandler(event, aui, registry?.getPlugins() ?? []);

/** Wire the handler into the Lexical editor rendered inside `containerRef`. */
export function useEscapeStop(containerRef: RefObject<HTMLDivElement | null>): void {
  const aui = useAui();
  const registry = INTERNAL.useComposerInputPluginRegistryOptional();
  useEffect(() => {
    const editor = containerRef.current?.querySelector<LexicalEditorElement>(".aui-lexical-input")?.__lexicalEditor;
    if (!editor) return;
    return editor.registerCommand(KEY_ESCAPE_COMMAND, makeEscapeStopListener(aui, registry), COMMAND_PRIORITY_CRITICAL);
  }, [containerRef, aui, registry]);
}
