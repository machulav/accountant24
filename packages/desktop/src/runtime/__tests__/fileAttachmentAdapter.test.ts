// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractAttachmentRefs } from "../../lib/attachmentMarker";
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

// base64("x") — the single-byte content of every fixture File above.
const B64_OF_X = "eA==";

beforeEach(() => {
  h.archive.mockReset();
  h.archive.mockResolvedValue("attachments/stored");
});

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

  it("should assign a stable id from name, size, and lastModified", async () => {
    const f = file("r.png", "image/png");
    const pending = await new WorkspaceFileAttachmentAdapter("*").add({ file: f });
    expect(pending.id).toBe(`r.png:${f.size}:${f.lastModified}`);
  });
});

describe("ArchivingImageAttachmentAdapter.send()", () => {
  it("should archive the file into the workspace under its own name and base64 bytes", async () => {
    const adapter = new ArchivingImageAttachmentAdapter();
    const pending = await adapter.add({ file: file("receipt.png", "image/png") });

    await adapter.send(pending);

    expect(h.archive).toHaveBeenCalledWith("receipt.png", B64_OF_X);
  });

  it("should send the image as inline vision content carrying the full data URL", async () => {
    const adapter = new ArchivingImageAttachmentAdapter();
    const pending = await adapter.add({ file: file("receipt.png", "image/png") });

    const complete = await adapter.send(pending);

    expect(complete.status).toEqual({ type: "complete" });
    expect(complete.content).toEqual([{ type: "image", image: `data:image/png;base64,${B64_OF_X}` }]);
  });

  it("should report the filename to onSend so a file-only chat can be titled from it", async () => {
    const onSend = vi.fn();
    const adapter = new ArchivingImageAttachmentAdapter(onSend);
    const pending = await adapter.add({ file: file("receipt.png", "image/png") });

    await adapter.send(pending);

    expect(onSend).toHaveBeenCalledWith("receipt.png");
  });

  it("should not require an onSend callback", async () => {
    const adapter = new ArchivingImageAttachmentAdapter();
    const pending = await adapter.add({ file: file("receipt.png", "image/png") });

    await expect(adapter.send(pending)).resolves.toMatchObject({ status: { type: "complete" } });
  });

  it("should reject and skip vision content when archiving fails", async () => {
    h.archive.mockRejectedValueOnce(new Error("disk full"));
    const onSend = vi.fn();
    const adapter = new ArchivingImageAttachmentAdapter(onSend);
    const pending = await adapter.add({ file: file("receipt.png", "image/png") });

    await expect(adapter.send(pending)).rejects.toThrow("disk full");
    // toContent runs only after a successful archive, so nothing is reported.
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("WorkspaceFileAttachmentAdapter.send()", () => {
  it("should archive the file and send only a one-line path marker (no raw bytes)", async () => {
    h.archive.mockResolvedValueOnce("attachments/statement.pdf");
    const adapter = new WorkspaceFileAttachmentAdapter("application/pdf");
    const pending = await adapter.add({ file: file("statement.pdf", "application/pdf") });

    const complete = await adapter.send(pending);

    expect(h.archive).toHaveBeenCalledWith("statement.pdf", B64_OF_X);
    expect(complete.status).toEqual({ type: "complete" });
    const parts = complete.content as { type: string; text: string }[];
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe("text");
    // The marker must NOT leak the file's bytes to the transcript.
    expect(parts[0]!.text).not.toContain(B64_OF_X);
  });

  it("should encode a marker that decodes back to the file name and archived workspace path", async () => {
    h.archive.mockResolvedValueOnce("attachments/statement.pdf");
    const adapter = new WorkspaceFileAttachmentAdapter("application/pdf");
    const pending = await adapter.add({ file: file("statement.pdf", "application/pdf") });

    const complete = await adapter.send(pending);
    const text = (complete.content as { text: string }[])[0]!.text;

    expect(extractAttachmentRefs(text)).toEqual({
      text: "",
      refs: [{ name: "statement.pdf", path: "attachments/statement.pdf" }],
    });
  });

  it("should reject when archiving the workspace file fails", async () => {
    h.archive.mockRejectedValueOnce(new Error("ENOSPC"));
    const adapter = new WorkspaceFileAttachmentAdapter("text/csv");
    const pending = await adapter.add({ file: file("book.csv", "text/csv") });

    await expect(adapter.send(pending)).rejects.toThrow("ENOSPC");
  });
});

describe("ArchivingAttachmentAdapter.remove()", () => {
  it("should keep the archived copy — remove is a no-op that resolves without touching the archive", async () => {
    const adapter = new WorkspaceFileAttachmentAdapter("*");

    await expect(adapter.remove()).resolves.toBeUndefined();
    expect(h.archive).not.toHaveBeenCalled();
  });
});
