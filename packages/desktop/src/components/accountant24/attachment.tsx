"use client";

// File/attachment UI: assistant-ui's attachment primitives wired to the stock
// shadcn Attachment components. Images go to the model as image content. PDFs
// (and other docs) are copied into the workspace by the app and travel to the
// agent as a one-line marker carrying the workspace path; here we strip that
// marker and render a file chip instead of the raw text (see
// lib/attachmentMarker + runtime/fileAttachmentAdapter).

import {
  AttachmentPrimitive,
  type Attachment as AuiAttachment,
  ComposerPrimitive,
  type ImageMessagePartComponent,
  type TextMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import { FileTextIcon, PaperclipIcon, XIcon } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { LedgerDirectiveText } from "@/components/accountant24/mentions";
import { TooltipIconButton } from "@/components/accountant24/tooltip-icon-button";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/shadcn/attachment";
import { InputGroupAddon } from "@/components/shadcn/input-group";
import { extractAttachmentRefs } from "@/lib/attachmentMarker";
import { cn } from "@/lib/utils";

/** Object-URL preview for a pending image File, revoked on unmount. */
const useImagePreview = (file: File | undefined): string | undefined => {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
};

/** Shared presentational file chip (icon + name), used both for pending
 *  composer attachments and sent ones in a message. Forwards rest props so it
 *  can sit under an assistant-ui `asChild` primitive. */
const FileChip: FC<React.ComponentProps<typeof Attachment> & { name: string }> = ({
  name,
  className,
  children,
  ...props
}) => (
  <Attachment size="sm" className={cn("bg-background", className)} {...props}>
    <AttachmentMedia>
      <FileTextIcon />
    </AttachmentMedia>
    <AttachmentContent>
      <AttachmentTitle title={name}>{name}</AttachmentTitle>
    </AttachmentContent>
    {children}
  </Attachment>
);

/** A single pending attachment in the composer: image thumbnail or a file chip,
 *  each with a remove button. Reads the current attachment from context, so it
 *  must render inside ComposerPrimitive.Attachments. */
const ComposerAttachmentTile: FC = () => {
  const attachment = useAuiState((s) => s.attachment) as AuiAttachment | undefined;
  const preview = useImagePreview(attachment?.file);
  if (!attachment) return null;

  const isImage = attachment.type === "image" && preview;

  const removeButton = (
    <AttachmentActions>
      <AttachmentPrimitive.Remove asChild>
        <AttachmentAction aria-label="Remove attachment">
          <XIcon />
        </AttachmentAction>
      </AttachmentPrimitive.Remove>
    </AttachmentActions>
  );

  if (isImage) {
    return (
      <AttachmentPrimitive.Root asChild>
        <Attachment size="sm" className="bg-background">
          <AttachmentMedia variant="image">
            <img src={preview} alt={attachment.name} />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle title={attachment.name}>{attachment.name}</AttachmentTitle>
          </AttachmentContent>
          {removeButton}
        </Attachment>
      </AttachmentPrimitive.Root>
    );
  }

  return (
    <AttachmentPrimitive.Root asChild>
      <FileChip name={attachment.name}>{removeButton}</FileChip>
    </AttachmentPrimitive.Root>
  );
};

/** Pending attachments shown above the composer input, as a top row of the
 *  composer's InputGroup. Hidden entirely while there are no attachments. */
export const ComposerAttachments: FC = () => (
  <InputGroupAddon
    align="block-start"
    data-slot="aui_composer-attachments"
    className="hidden flex-wrap gap-2 has-data-[slot=attachment]:flex"
  >
    <ComposerPrimitive.Attachments>{() => <ComposerAttachmentTile />}</ComposerPrimitive.Attachments>
  </InputGroupAddon>
);

/** Paperclip button that opens the file picker. The primitive disables itself
 *  (renders nothing actionable) when no attachment adapter is configured. */
export const ComposerAddAttachment: FC = () => (
  <ComposerPrimitive.AddAttachment asChild multiple>
    <TooltipIconButton
      tooltip="Attach files"
      side="bottom"
      type="button"
      variant="ghost"
      size="icon"
      // No left compensation: the glyph keeps equal 17px insets to the left
      // and bottom edges (a balanced corner beats aligning the icon with the
      // text column above — both are impossible at once).
      aria-label="Attach files"
    >
      <PaperclipIcon className="size-4" />
    </TooltipIconButton>
  </ComposerPrimitive.AddAttachment>
);

/** Renders a sent image inside a user message. react-pi projects sent images as
 *  `image` content parts, so this plugs into MessagePrimitive.Parts as the
 *  `Image` component (the built-in default renders nothing). */
export const UserMessageImage: ImageMessagePartComponent = ({ image, filename }) => (
  <img
    src={image}
    alt={filename ?? "attachment"}
    className="border-border/60 mb-2 max-h-80 max-w-full rounded-xl border object-contain"
  />
);

/** Renders a sent user-message text part. Non-image attachments arrive inlined
 *  as `[[attachment]]{…}` markers; we lift them out as file chips and show only
 *  the human-written text, with any @-mention directives rendered as chips. */
export const UserMessageText: TextMessagePartComponent = (props) => {
  const { text: visible, refs } = extractAttachmentRefs(props.text);
  return (
    <>
      {refs.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 empty:hidden">
          {refs.map((ref, i) => (
            <FileChip key={`${ref.path}-${i}`} name={ref.name} className="max-w-full" />
          ))}
        </div>
      )}
      {visible && <LedgerDirectiveText {...props} text={visible} />}
    </>
  );
};
