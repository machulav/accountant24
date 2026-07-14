"use client";

// The chat composer: a stock InputGroup shell around the Lexical mentions
// input, with an attachments row on top and the action row (attach, model
// picker, dictation, send) below. EditComposer is the in-place variant shown
// when editing an already sent user message.

import {
  type AssistantState,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { ArrowUpIcon, MicIcon, SquareIcon } from "lucide-react";
import type { ClipboardEvent, FC } from "react";
import { ComposerAddAttachment, ComposerAttachments } from "@/components/accountant24/attachment";
import { ComposerModelSelector } from "@/components/accountant24/composer-model-selector";
import { ComposerSkills } from "@/components/accountant24/composer-skills";
import { DirectiveChip } from "@/components/accountant24/directive-chips";
import { ComposerMentions } from "@/components/accountant24/mentions";
import { RotatingPlaceholderInput } from "@/components/accountant24/rotating-placeholder";
import { TooltipIconButton } from "@/components/accountant24/tooltip-icon-button";
import { Button } from "@/components/shadcn/button";
import { InputGroup, InputGroupAddon } from "@/components/shadcn/input-group";

// Center the composer only for a genuinely new, empty chat. "New chat" is the
// not-yet-created thread (its id is the runtime's `newThreadId`); switching to an
// existing thread keeps the docked layout. Keying off `mainThreadId ===
// newThreadId` (a stable fact) instead of `!isLoading` avoids a flicker: during a
// switch there's a frame where messages are already cleared but `isLoading` hasn't
// flipped true yet, which made the welcome layout flash. `threads.isLoading`
// covers the startup placeholder before the thread list resolves.
export const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (s.threads.mainThreadId === s.threads.newThreadId || s.threads.isLoading);

/** Attach pasted files instead of letting Lexical insert their names as text.
 *  Mirrors ComposerPrimitive.Input's built-in addAttachmentOnPaste, which the
 *  Lexical input lacks. Plain text pastes pass through untouched. Exported for
 *  tests; `aui` is typed structurally so tests can pass a fake. */
export const handleComposerFilePaste = (
  e: Pick<ClipboardEvent, "clipboardData" | "preventDefault" | "stopPropagation">,
  aui: {
    thread: () => { getState: () => { capabilities: { attachments: boolean } } };
    composer: () => { addAttachment: (file: File) => Promise<void> };
  },
): void => {
  const files = Array.from(e.clipboardData?.files ?? []);
  if (files.length === 0 || !aui.thread().getState().capabilities.attachments) return;
  e.preventDefault();
  e.stopPropagation();
  void Promise.all(files.map((file) => aui.composer().addAttachment(file))).catch((error) => {
    console.error("Error adding attachment:", error);
  });
};

export const Composer: FC = () => {
  const isNewChat = useAuiState(isNewChatView);
  const aui = useAui();
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          {/* Stock InputGroup shell; the only custom classes are the
              drag-and-drop affordance (no stock equivalent). */}
          <InputGroup
            data-slot="aui_composer-shell"
            className="data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50"
            // Capture phase: file pastes must never reach Lexical's own paste
            // handling inside.
            onPasteCapture={(e) => handleComposerFilePaste(e, aui)}
          >
            <ComposerAttachments />
            <RotatingPlaceholderInput
              rotate={isNewChat}
              className="aui-composer-input max-h-32 w-full bg-transparent text-base"
              autoFocus
              directiveChip={DirectiveChip}
              aria-label="Message input"
            />
            <ComposerMentions />
            <ComposerSkills />
            <ComposerAction />
          </InputGroup>
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
};

const ComposerAction: FC = () => {
  return (
    <InputGroupAddon align="block-end" className="aui-composer-action-wrapper justify-between">
      {/* No gap: the attach button's and the model pill's own ghost paddings
          already put ~14px between the visible glyph and the model name. */}
      <div className="flex items-center">
        <ComposerAddAttachment />
        <ComposerModelSelector />
      </div>
      <div className="flex items-center gap-1.5">
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip="Voice input"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-dictate"
                aria-label="Start voice input"
              >
                <MicIcon className="aui-composer-dictate-icon size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip="Stop dictation"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-stop-dictation text-destructive"
                aria-label="Stop voice input"
              >
                <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send"
              aria-label="Send message"
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4.5" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-6 p-1"
              aria-label="Stop generating"
            >
              <SquareIcon className="aui-composer-cancel-icon size-2.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </InputGroupAddon>
  );
};

export const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root data-slot="aui_edit-composer-wrapper" className="flex flex-col px-2">
      <ComposerPrimitive.Root className="aui-edit-composer-root bg-input/50 ms-auto flex w-full max-w-[85%] flex-col rounded-3xl">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 rounded-full px-3.5">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};
