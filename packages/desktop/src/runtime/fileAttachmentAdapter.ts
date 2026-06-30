// Attachment adapters that archive every file into the workspace, then hand the
// agent either native content or a path:
//  - ArchivingImageAttachmentAdapter: model-readable images → archived AND sent
//    as image content (vision).
//  - WorkspaceFileAttachmentAdapter: everything else (PDF, CSV, …) → archived
//    and sent as a one-line path marker (the chat UI renders it as a file chip;
//    the agent reads/extracts it from the workspace). pi carries only text +
//    images to the model, so non-image files can only travel as a path.

import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";
import { encodeAttachmentRef } from "../lib/attachmentMarker";
import { filesApi } from "../rpc/api";

/** Read a File as a data URL (`data:<mime>;base64,<data>`). */
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const base64Of = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(",") + 1);

/** Shared base: archive the file into the workspace on send, then let the
 *  subclass decide how it reaches the agent (native content vs path marker). */
abstract class ArchivingAttachmentAdapter implements AttachmentAdapter {
  abstract accept: string;
  protected abstract type: PendingAttachment["type"];
  /** How the archived file is presented to the agent. */
  protected abstract toContent(name: string, path: string, dataUrl: string): CompleteAttachment["content"];

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    return {
      id: `${file.name}:${file.size}:${file.lastModified}`,
      type: this.type,
      name: file.name,
      contentType: file.type,
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const dataUrl = await readDataUrl(attachment.file);
    const path = await filesApi.archiveToWorkspace(attachment.name, base64Of(dataUrl));
    return {
      ...attachment,
      status: { type: "complete" },
      content: this.toContent(attachment.name, path, dataUrl),
    };
  }

  async remove() {
    // The archived copy is intentionally kept; nothing to clean up.
  }
}

/** Image types Claude can actually read. Other "image/*" (heic, tiff, svg…) fall
 *  through to the workspace-file adapter and are sent as a path. */
const MODEL_IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp";

export class ArchivingImageAttachmentAdapter extends ArchivingAttachmentAdapter {
  accept = MODEL_IMAGE_TYPES;
  protected type = "image" as const;

  // pi projects a sent image as a bare `image` content part — the filename is
  // dropped, so it can't be recovered from the transcript later. Report it here
  // (the one place we still have it) so a file-only chat can be titled from it.
  constructor(private readonly onSend?: (name: string) => void) {
    super();
  }

  protected toContent(name: string, _path: string, dataUrl: string) {
    this.onSend?.(name);
    return [{ type: "image" as const, image: dataUrl }];
  }
}

export class WorkspaceFileAttachmentAdapter extends ArchivingAttachmentAdapter {
  protected type = "document" as const;

  constructor(public accept: string) {
    super();
  }

  protected toContent(name: string, path: string) {
    return [{ type: "text" as const, text: encodeAttachmentRef({ name, path }) }];
  }
}
