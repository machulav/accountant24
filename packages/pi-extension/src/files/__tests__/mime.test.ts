import { beforeEach, describe, expect, it, vi } from "vitest";

// file-type is the I/O-ish boundary (byte sniffing); mock it so each test drives
// the sniff result deterministically and mime.ts's own fallback logic runs for real.
const sniff = vi.hoisted(() => vi.fn());
vi.mock("file-type", () => ({ fileTypeFromBuffer: sniff }));

import { detectMimeType } from "../mime";

const bytes = Buffer.from([0x00, 0x01, 0x02]);

beforeEach(() => {
  sniff.mockReset();
});

describe("detectMimeType()", () => {
  it("should return the sniffed mime when the bytes are recognized, ignoring the extension", async () => {
    sniff.mockResolvedValue({ mime: "image/png", ext: "png" });
    expect(await detectMimeType(bytes, "/whatever/file.bin")).toBe("image/png");
  });

  it("should prefer the sniffed mime over a conflicting extension", async () => {
    // jpeg bytes in a file named .png → trust the bytes
    sniff.mockResolvedValue({ mime: "image/jpeg", ext: "jpg" });
    expect(await detectMimeType(bytes, "/x/photo.png")).toBe("image/jpeg");
  });

  it("should fall back to .pdf → application/pdf when sniffing fails", async () => {
    sniff.mockResolvedValue(undefined);
    expect(await detectMimeType(bytes, "/x/statement.pdf")).toBe("application/pdf");
  });

  it("should fall back to .png → image/png when sniffing fails", async () => {
    sniff.mockResolvedValue(undefined);
    expect(await detectMimeType(bytes, "/x/a.png")).toBe("image/png");
  });

  it("should fall back to .jpg and .jpeg → image/jpeg when sniffing fails", async () => {
    sniff.mockResolvedValue(undefined);
    expect(await detectMimeType(bytes, "/x/a.jpg")).toBe("image/jpeg");
    expect(await detectMimeType(bytes, "/x/a.jpeg")).toBe("image/jpeg");
  });

  it("should match the extension case-insensitively", async () => {
    sniff.mockResolvedValue(undefined);
    expect(await detectMimeType(bytes, "/x/A.PDF")).toBe("application/pdf");
  });

  it("should return application/octet-stream for an unknown extension with unsniffable bytes", async () => {
    sniff.mockResolvedValue(undefined);
    expect(await detectMimeType(bytes, "/x/notes.xyz")).toBe("application/octet-stream");
  });

  it("should return application/octet-stream when there is no extension at all", async () => {
    sniff.mockResolvedValue(undefined);
    expect(await detectMimeType(bytes, "/x/README")).toBe("application/octet-stream");
  });
});
