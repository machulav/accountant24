"use client";

// File/attachment UI built on assistant-ui's standard attachment primitives.
// Images go to the model as image content. PDFs (and other docs) are copied into
// the workspace by the app and travel to the agent as a one-line marker carrying
// the workspace path; here we strip that marker and render a file chip instead of
// the raw text (see lib/attachmentMarker + runtime/fileAttachmentAdapter).

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { LedgerDirectiveText } from "@/components/assistant-ui/mentions";
import { extractAttachmentRefs } from "@/lib/attachmentMarker";
import { cn } from "@/lib/utils";
import {
  type Attachment,
  AttachmentPrimitive,
  ComposerPrimitive,
  type ImageMessagePartComponent,
  type TextMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import { FileTextIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useEffect, useState, type FC } from "react";

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
 *  composer attachments and sent ones in a message. */
const FileChip: FC<{ name: string; className?: string }> = ({
  name,
  className,
}) => (
  <div
    className={cn(
      "flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2",
      className,
    )}
  >
    <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
    <span className="truncate text-sm" title={name}>
      {name}
    </span>
  </div>
);

/** A single pending attachment in the composer: image thumbnail or a file chip,
 *  each with a remove button. Reads the current attachment from context, so it
 *  must render inside ComposerPrimitive.Attachments. */
const ComposerAttachmentTile: FC = () => {
  const attachment = useAuiState((s) => s.attachment) as Attachment | undefined;
  const preview = useImagePreview(attachment?.file);
  if (!attachment) return null;

  const isImage = attachment.type === "image" && preview;

  return (
    <AttachmentPrimitive.Root className="group/attachment relative">
      {isImage ? (
        <img
          src={preview}
          alt={attachment.name}
          className="size-16 rounded-lg border border-border/60 object-cover"
        />
      ) : (
        <FileChip name={attachment.name} className="h-16 w-40" />
      )}
      <AttachmentPrimitive.Remove asChild>
        <TooltipIconButton
          tooltip="Remove attachment"
          side="top"
          type="button"
          variant="default"
          size="icon"
          className="absolute -right-1.5 -top-1.5 size-5 rounded-full opacity-0 shadow transition-opacity group-hover/attachment:opacity-100 focus-visible:opacity-100"
          aria-label="Remove attachment"
        >
          <XIcon className="size-3" />
        </TooltipIconButton>
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
};

/** Pending attachments shown above the composer input. Hidden when empty. */
export const ComposerAttachments: FC = () => (
  <div className="flex flex-row flex-wrap gap-2 px-1 pt-1 empty:hidden">
    <ComposerPrimitive.Attachments>
      {() => <ComposerAttachmentTile />}
    </ComposerPrimitive.Attachments>
  </div>
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
      className="size-7 rounded-full"
      aria-label="Attach files"
    >
      <PaperclipIcon className="size-4" />
    </TooltipIconButton>
  </ComposerPrimitive.AddAttachment>
);

/** Renders a sent image inside a user message. react-pi projects sent images as
 *  `image` content parts, so this plugs into MessagePrimitive.Parts as the
 *  `Image` component (the built-in default renders nothing). */
export const UserMessageImage: ImageMessagePartComponent = ({
  image,
  filename,
}) => (
  <img
    src={image}
    alt={filename ?? "attachment"}
    className={cn(
      "mb-2 max-h-80 max-w-full rounded-xl border border-border/60 object-contain",
    )}
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
