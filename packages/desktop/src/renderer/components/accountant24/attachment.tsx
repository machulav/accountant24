"use client";

// File/attachment UI: assistant-ui's attachment primitives wired to the stock
// shadcn Attachment components. Images go to the model as image content. PDFs
// (and other docs) are copied into the workspace by the app and travel to the
// agent as a one-line marker carrying the workspace path (see
// lib/attachmentMarker + runtime/fileAttachmentAdapter). In a sent message,
// attachments render as cards in a row above the bubble (UserMessageAttachments)
// rather than inside it, so a file-only message is just its card — never an
// empty bubble wrapping a chip.

import {
  AttachmentPrimitive,
  type Attachment as AuiAttachment,
  ComposerPrimitive,
  type ImageMessagePartComponent,
  MessagePrimitive,
  type TextMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import { FileImageIcon, FileSpreadsheetIcon, FileTextIcon, PaperclipIcon, XIcon } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { DirectiveText } from "@/components/accountant24/directive-chips";
import { TooltipIconButton } from "@/components/accountant24/tooltip-icon-button";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/shadcn/attachment";
import { InputGroupAddon } from "@/components/shadcn/input-group";
import { extractAttachmentRefs } from "@/lib/attachmentMarker";
import { type FileKind, fileKind, fileTypeLabel, formatFileSize } from "@/lib/fileInfo";
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

const KIND_ICONS: Record<FileKind, typeof FileTextIcon> = {
  document: FileTextIcon,
  spreadsheet: FileSpreadsheetIcon,
  image: FileImageIcon,
};

/** The card's muted second line: file type, plus the size when known
 *  ("PDF · 245 KB"). Sent messages only carry the name, so size is optional. */
const cardDescription = (name: string, sizeBytes?: number): string =>
  [fileTypeLabel(name), sizeBytes === undefined ? "" : formatFileSize(sizeBytes)].filter(Boolean).join(" · ");

/** Shared card geometry for every attachment (file chips and composer image
 *  tiles). Fixed w-72 instead of the stock w-fit: content-hugging cards give a
 *  multi-file row ragged widths, while uniform cards wrap into a tidy grid
 *  (the cva's own max-w-full still caps them on narrow containers). rounded-xl
 *  instead of the stock pill rounding: it matches the sent image cards, and
 *  the pill read as a second bubble nested inside the message bubble. */
const AttachmentCard: FC<React.ComponentProps<typeof Attachment>> = ({ className, ...props }) => (
  // font-normal on the description: it sets no weight of its own, so inside
  // the composer it inherits the InputGroupAddon's font-medium and renders
  // bolder than the same card in a message.
  <Attachment
    className={cn("w-72 rounded-xl **:data-[slot=attachment-description]:font-normal", className)}
    {...props}
  />
);

/** Presentational file card: type icon + name + muted type line. The type line
 *  keeps the file identifiable when the name is an opaque id and truncation
 *  hides the extension. Forwards rest props so it can sit under an assistant-ui
 *  `asChild` primitive. */
const FileCard: FC<React.ComponentProps<typeof Attachment> & { name: string; sizeBytes?: number }> = ({
  name,
  sizeBytes,
  children,
  ...props
}) => {
  const Icon = KIND_ICONS[fileKind(name)];
  const description = cardDescription(name, sizeBytes);
  return (
    <AttachmentCard {...props}>
      {/* rounded-lg: near-concentric with the card's rounded-xl, where the
          stock rounding turns the icon box into a circle. */}
      <AttachmentMedia className="rounded-lg">
        <Icon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle title={name}>{name}</AttachmentTitle>
        {description && <AttachmentDescription>{description}</AttachmentDescription>}
      </AttachmentContent>
      {children}
    </AttachmentCard>
  );
};

/** A single pending attachment in the composer: image thumbnail or a file card,
 *  each with a remove button. Reads the current attachment from context, so it
 *  must render inside ComposerPrimitive.Attachments. */
const ComposerAttachmentTile: FC = () => {
  const attachment = useAuiState((s) => s.attachment) as AuiAttachment | undefined;
  const preview = useImagePreview(attachment?.file);
  if (!attachment) return null;

  const isImage = attachment.type === "image" && preview;
  const sizeBytes = attachment.file?.size;

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
    const description = sizeBytes === undefined ? "" : cardDescription(attachment.name, sizeBytes);
    return (
      <AttachmentPrimitive.Root asChild>
        <AttachmentCard>
          <AttachmentMedia variant="image" className="rounded-lg">
            <img src={preview} alt={attachment.name} />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle title={attachment.name}>{attachment.name}</AttachmentTitle>
            {description && <AttachmentDescription>{description}</AttachmentDescription>}
          </AttachmentContent>
          {removeButton}
        </AttachmentCard>
      </AttachmentPrimitive.Root>
    );
  }

  return (
    <AttachmentPrimitive.Root asChild>
      <FileCard name={attachment.name} sizeBytes={sizeBytes}>
        {removeButton}
      </FileCard>
    </AttachmentPrimitive.Root>
  );
};

/** Pending attachments shown above the composer input, as a top row of the
 *  composer's InputGroup. Hidden entirely while there are no attachments.
 *  pb-0: the addon's own bottom padding would stack on the Lexical input's
 *  16px top padding, pushing the input text ~10px farther from the cards
 *  above it than from the action row below. */
export const ComposerAttachments: FC = () => (
  <InputGroupAddon
    align="block-start"
    data-slot="aui_composer-attachments"
    className="hidden flex-wrap gap-2 pb-0 has-data-[slot=attachment]:flex"
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

/** Renders a sent image inside the message's attachment row. react-pi projects
 *  sent images as `image` content parts, so this plugs into
 *  MessagePrimitive.Parts as the `Image` component. */
export const UserMessageImage: ImageMessagePartComponent = ({ image, filename }) => (
  <img
    src={image}
    alt={filename ?? "attachment"}
    className="border-border/60 max-h-80 max-w-full rounded-xl border object-contain"
  />
);

/** A text part projected down to its attachment markers: one file card per
 *  marker, none of the text. The counterpart of UserMessageText, for the
 *  attachment row above the bubble. */
export const UserMessageFileCards: TextMessagePartComponent = ({ text }) => (
  <>
    {extractAttachmentRefs(text).refs.map((ref, i) => (
      <FileCard key={`${ref.path}-${i}`} name={ref.name} sizeBytes={ref.size} />
    ))}
  </>
);

/** The sent attachments of a user message, lifted out of the bubble: images and
 *  file cards in a right-aligned row above the message text. Hidden while the
 *  message has no attachments. Must render inside MessagePrimitive.Root. */
export const UserMessageAttachments: FC = () => (
  <div data-slot="aui_user-attachments" className="flex max-w-[80%] flex-wrap justify-end gap-2 empty:hidden">
    <MessagePrimitive.Parts components={{ Image: UserMessageImage, Text: UserMessageFileCards }} />
  </div>
);

/** Renders a sent user-message text part: only the human-written text, with any
 *  directives (@-mentions, picked skills) as inline chips. Attachment markers
 *  are stripped — UserMessageAttachments renders them above the bubble. A
 *  manual skill invocation reaches this component already collapsed to its
 *  `:skill[name]` directive (electronPiClient rewrites pi's expanded block on
 *  the way in), so no skill-specific handling lives here. */
export const UserMessageText: TextMessagePartComponent = (props) => {
  const { text: visible } = extractAttachmentRefs(props.text);
  return visible ? <DirectiveText {...props} text={visible} /> : null;
};
