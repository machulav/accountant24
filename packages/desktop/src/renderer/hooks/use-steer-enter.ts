// While the agent runs, plain Enter sends the composer text as a steering
// message (pi delivers it after the current tool call and re-plans). The
// library input's own KeyboardPlugin (LexicalComposerInput, priority HIGH)
// hard-blocks Enter while `thread.isRunning`; this hook registers a
// KEY_ENTER_COMMAND handler at CRITICAL priority (Lexical dispatches highest
// first) that takes over ONLY in that blocked case — idle submits, Shift+Enter
// newlines, and popover navigation all fall through to the library untouched.

import { INTERNAL, useAui } from "@assistant-ui/react";
import { COMMAND_PRIORITY_CRITICAL, KEY_ENTER_COMMAND, type LexicalEditor } from "lexical";
import { type RefObject, useEffect } from "react";

/** Lexical exposes the live editor instance on the contenteditable it manages;
 *  LexicalComposerInput offers no plugin slot, so this is the only way in from
 *  the outside (same handle as use-delete-line-with-chips). */
type LexicalEditorElement = HTMLElement & { __lexicalEditor?: LexicalEditor };

/** The aui surface the handler touches, typed structurally so tests pass a fake. */
export interface SteerEnterAui {
  thread(): { getState(): { isRunning: boolean } };
  composer(): { send(options: { steer: boolean }): void };
}

/** A composer-input plugin (mention/skill popover) that may own the key. */
export interface SteerEnterPlugin {
  handleKeyDown(event: KeyboardEvent): boolean;
}

/** Exported for tests: the KEY_ENTER_COMMAND handler body. Returns true when
 *  it consumed the Enter (a mid-run steer send), false to fall through. */
export function steerEnterHandler(
  event: KeyboardEvent | null,
  aui: SteerEnterAui,
  plugins: readonly SteerEnterPlugin[],
): boolean {
  if (!event || event.isComposing) return false;
  if (event.shiftKey || event.ctrlKey || event.metaKey) return false;
  if (!aui.thread().getState().isRunning) return false;
  // An open mention/skill popover owns Enter (item selection) — the same
  // delegation the library input does ahead of its own submit.
  for (const plugin of plugins) {
    if (plugin.handleKeyDown(event)) return true;
  }
  event.preventDefault();
  // No-ops on an empty composer (the canSend gate) — Enter then does nothing,
  // matching the idle behavior.
  aui.composer().send({ steer: true });
  return true;
}

/** The plugin registry surface the listener reads, typed structurally. */
export interface SteerEnterRegistry {
  getPlugins(): readonly SteerEnterPlugin[];
}

/** Build the Lexical command listener (exported for tests). The plugin list is
 *  read per keypress, not at registration, so popovers opened later count. */
export const makeSteerEnterListener =
  (aui: SteerEnterAui, registry: SteerEnterRegistry | null) =>
  (event: KeyboardEvent | null): boolean =>
    steerEnterHandler(event, aui, registry?.getPlugins() ?? []);

/** Wire the handler into the Lexical editor rendered inside `containerRef`. */
export function useSteerEnter(containerRef: RefObject<HTMLDivElement | null>): void {
  const aui = useAui();
  const registry = INTERNAL.useComposerInputPluginRegistryOptional();
  useEffect(() => {
    const editor = containerRef.current?.querySelector<LexicalEditorElement>(".aui-lexical-input")?.__lexicalEditor;
    if (!editor) return;
    return editor.registerCommand(KEY_ENTER_COMMAND, makeSteerEnterListener(aui, registry), COMMAND_PRIORITY_CRITICAL);
  }, [containerRef, aui, registry]);
}
