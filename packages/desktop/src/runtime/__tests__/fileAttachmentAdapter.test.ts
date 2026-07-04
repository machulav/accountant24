import { describe, expect, it, vi } from "vitest";
import {
  ArchivingImageAttachmentAdapter,
  attachmentKind,
  WorkspaceFileAttachmentAdapter,
} from "../fileAttachmentAdapter";

// The adapters archive files over Electron IPC (the faked boundary) and report
// only a coarse attachment kind to analytics — never the filename or content.

const h = vi.hoisted(() => ({
  track: vi.fn(),
  archive: vi.fn(async () => "attachments/stored"),
}));

vi.mock("../../rpc/api", () => ({
  analyticsApi: { track: h.track },
  filesApi: { archiveToWorkspace: h.archive },
}));

const file = (name: string, type: string) => new File(["x"], name, { type });

describe("attachmentKind()", () => {
  it("should return image for any image mime type", () => {
    expect(attachmentKind("image/jpeg")).toBe("image");
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("image/heic")).toBe("image");
  });

  it("should return pdf for application/pdf", () => {
    expect(attachmentKind("application/pdf")).toBe("pdf");
  });

  it("should return csv for text/csv", () => {
    expect(attachmentKind("text/csv")).toBe("csv");
  });

  it("should return other for anything else, including an empty mime type", () => {
    expect(attachmentKind("application/zip")).toBe("other");
    expect(attachmentKind("text/plain")).toBe("other");
    expect(attachmentKind("")).toBe("other");
  });
});

describe("ArchivingAttachmentAdapter.add()", () => {
  it("should track attachment_added with kind image when an image is attached", async () => {
    await new ArchivingImageAttachmentAdapter().add({ file: file("receipt.jpg", "image/jpeg") });
    expect(h.track).toHaveBeenCalledWith("attachment_added", { kind: "image" });
  });

  it("should track attachment_added with kind pdf when a statement is attached", async () => {
    await new WorkspaceFileAttachmentAdapter("*").add({ file: file("statement.pdf", "application/pdf") });
    expect(h.track).toHaveBeenCalledWith("attachment_added", { kind: "pdf" });
  });

  it("should never include the filename in the tracked props", async () => {
    await new WorkspaceFileAttachmentAdapter("*").add({ file: file("secret-payee.csv", "text/csv") });
    const [event, props] = h.track.mock.calls[0];
    expect(event).toBe("attachment_added");
    expect(JSON.stringify(props)).not.toContain("secret-payee");
  });

  it("should return a pending attachment awaiting composer send", async () => {
    const pending = await new ArchivingImageAttachmentAdapter().add({ file: file("r.png", "image/png") });
    expect(pending).toMatchObject({
      type: "image",
      name: "r.png",
      contentType: "image/png",
      status: { type: "requires-action", reason: "composer-send" },
    });
  });
});
