// @vitest-environment jsdom

// Spec for the composer's paste-to-attach behavior (the Lexical input has no
// built-in equivalent of the textarea composer's addAttachmentOnPaste).

import { describe, expect, it, vi } from "vitest";
import { handleComposerFilePaste } from "../composer";

const makeEvent = (files: File[]) => ({
  clipboardData: { files } as unknown as DataTransfer,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
});

const makeAui = (attachments = true) => {
  const addAttachment = vi.fn().mockResolvedValue(undefined);
  return {
    aui: {
      thread: () => ({ getState: () => ({ capabilities: { attachments } }) }),
      composer: () => ({ addAttachment }),
    },
    addAttachment,
  };
};

const file = (name: string) => new File([new Uint8Array([1])], name, { type: "image/png" });

describe("handleComposerFilePaste()", () => {
  it("should attach every pasted file and swallow the paste event", () => {
    const { aui, addAttachment } = makeAui();
    const e = makeEvent([file("a.png"), file("b.png")]);
    handleComposerFilePaste(e, aui);
    expect(addAttachment).toHaveBeenCalledTimes(2);
    expect(addAttachment).toHaveBeenCalledWith(e.clipboardData.files[0]);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it("should let plain text pastes pass through untouched", () => {
    const { aui, addAttachment } = makeAui();
    const e = makeEvent([]);
    handleComposerFilePaste(e, aui);
    expect(addAttachment).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("should do nothing when the thread does not support attachments", () => {
    const { aui, addAttachment } = makeAui(false);
    const e = makeEvent([file("a.png")]);
    handleComposerFilePaste(e, aui);
    expect(addAttachment).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
