// @vitest-environment jsdom

import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  DELETE_LINE_COMMAND,
  DecoratorNode,
  type LexicalEditor,
} from "lexical";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteLineAcrossChips } from "../use-delete-line-with-chips";

/** Minimal decorator standing in for a directive chip. */
class TestChipNode extends DecoratorNode<null> {
  static getType(): string {
    return "test-chip";
  }
  static clone(node: TestChipNode): TestChipNode {
    return new TestChipNode(node.__key);
  }
  static importJSON(): TestChipNode {
    return new TestChipNode();
  }
  exportJSON() {
    return { type: "test-chip", version: 1 };
  }
  createDOM(): HTMLElement {
    return document.createElement("span");
  }
  updateDOM(): boolean {
    return false;
  }
  decorate(): null {
    return null;
  }
  getTextContent(): string {
    return "[chip]";
  }
  isInline(): true {
    return true;
  }
}

let editor: LexicalEditor;

/** Build a paragraph from parts ("text", chip, "\n") and put the caret at the
 *  end (or at the given element offset). */
function setup(parts: Array<string | "CHIP" | "BR">, caretElementOffset?: number): void {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      for (const part of parts) {
        if (part === "CHIP") p.append(new TestChipNode());
        else if (part === "BR") p.append($createLineBreakNode());
        else p.append($createTextNode(part));
      }
      root.append(p);
      if (caretElementOffset === undefined) {
        p.selectEnd();
      } else {
        const sel = $createRangeSelection();
        sel.anchor.set(p.getKey(), caretElementOffset, "element");
        sel.focus.set(p.getKey(), caretElementOffset, "element");
        $setSelection(sel);
      }
    },
    { discrete: true },
  );
}

/** Dispatch wrapped in an update: a headless editor (no root element) silently
 *  discards mutations made by bare-dispatch command listeners — an artifact of
 *  the harness, not of the handler; DOM-attached editors (the real app) commit
 *  them, which is what the wrap emulates. */
const dispatchDeleteLine = (isBackward = true): boolean => {
  let handled = false;
  editor.update(
    () => {
      handled = editor.dispatchCommand(DELETE_LINE_COMMAND, isBackward);
    },
    { discrete: true },
  );
  return handled;
};

const text = (): string => editor.getEditorState().read(() => $getRoot().getTextContent());

beforeEach(() => {
  editor = createEditor({
    nodes: [TestChipNode],
    onError: (e) => {
      throw e;
    },
  });
  editor.registerCommand(DELETE_LINE_COMMAND, deleteLineAcrossChips, COMMAND_PRIORITY_HIGH);
});

describe("deleteLineAcrossChips()", () => {
  it("should delete the whole line when a chip sits between the caret and the line start", () => {
    setup(["hello ", "CHIP", " world"]);
    expect(dispatchDeleteLine()).toBe(true);
    expect(text()).toBe("");
  });

  it("should delete the chip when the caret sits right after it", () => {
    setup(["ask ", "CHIP"], 2);
    expect(dispatchDeleteLine()).toBe(true);
    expect(text()).toBe("");
  });

  it("should fall through to the native path for a chip-free line", () => {
    setup(["hello world"]);
    expect(dispatchDeleteLine()).toBe(false);
    expect(text()).toBe("hello world");
  });

  it("should only consider the current line, stopping at a Shift+Enter linebreak", () => {
    setup(["first ", "CHIP", "BR", "second line"]);
    // Caret at end: the last line has no chip → native path.
    expect(dispatchDeleteLine()).toBe(false);
    expect(text()).toContain("[chip]");
  });

  it("should clear only the last line when the chip is after the linebreak", () => {
    setup(["first", "BR", "CHIP", " tail"]);
    expect(dispatchDeleteLine()).toBe(true);
    expect(text()).toBe("first\n");
  });

  it("should ignore forward delete-line", () => {
    setup(["a ", "CHIP"]);
    expect(dispatchDeleteLine(false)).toBe(false);
  });
});
