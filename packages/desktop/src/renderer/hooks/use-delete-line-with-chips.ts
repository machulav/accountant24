// Cmd+Backspace (delete to line start) stalls on directive chips: Lexical's
// built-in deleteLine stops at decorator nodes, so the shortcut erases text up
// to a chip and then goes dead until the user releases Cmd and taps plain
// Backspace (Option+Backspace works because deleteWord DOES handle decorators).
// This hook registers a DELETE_LINE_COMMAND handler ahead of the built-in one
// that takes over only when a chip sits between the caret and the line start,
// deleting the whole segment in one go; chip-free lines fall through to
// Lexical's native (visual-line) behavior untouched.

import {
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  DELETE_LINE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { type RefObject, useEffect } from "react";

/** Lexical exposes the live editor instance on the contenteditable it manages
 *  (the same handle its own devtools use). LexicalComposerInput offers no
 *  plugin slot, so this is the only way in from the outside. */
type LexicalEditorElement = HTMLElement & { __lexicalEditor?: LexicalEditor };

/** Exported for tests: the DELETE_LINE_COMMAND handler body. Returns true when
 *  it handled the deletion (a chip was in the way), false to fall through. */
export function deleteLineAcrossChips(isBackward: boolean): boolean {
  if (!isBackward) return false;
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

  // Resolve the caret to (block element, index of the child the caret follows).
  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  let block: ReturnType<typeof anchorNode.getParent>;
  let childIndex: number;
  if (anchor.type === "element" && $isElementNode(anchorNode)) {
    block = anchorNode;
    childIndex = anchor.offset;
  } else {
    block = anchorNode.getParent();
    childIndex = anchorNode.getIndexWithinParent();
  }
  if (!$isElementNode(block)) return false;

  // Scan back to the logical line start (past a Shift+Enter linebreak or the
  // block start). Only take over when a chip is in the segment — the anchor's
  // own text node can't contain one, so full preceding siblings decide.
  const children = block.getChildren();
  let lineStartIndex = 0;
  let hasChip = false;
  for (let i = childIndex - 1; i >= 0; i--) {
    const child = children[i];
    if ($isLineBreakNode(child)) {
      lineStartIndex = i + 1;
      break;
    }
    if ($isDecoratorNode(child)) hasChip = true;
  }
  if (!hasChip) return false;

  // Explicit node surgery (a selection.removeText() over a mixed element/text
  // backward range silently no-ops in Lexical 0.45): drop the full siblings
  // between the line start and the caret, trim the caret text node's prefix,
  // and collapse the caret at the deletion point.
  for (const node of children.slice(lineStartIndex, childIndex)) {
    node.remove();
  }
  if (anchor.type === "text" && $isTextNode(anchorNode)) {
    anchorNode.setTextContent(anchorNode.getTextContent().slice(anchor.offset));
    anchorNode.select(0, 0);
  } else {
    block.select(lineStartIndex, lineStartIndex);
  }
  return true;
}

/** Wire the handler into the Lexical editor rendered inside `containerRef`. */
export function useDeleteLineWithChips(containerRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const editor = containerRef.current?.querySelector<LexicalEditorElement>(".aui-lexical-input")?.__lexicalEditor;
    if (!editor) return;
    return editor.registerCommand(DELETE_LINE_COMMAND, deleteLineAcrossChips, COMMAND_PRIORITY_HIGH);
  }, [containerRef]);
}
