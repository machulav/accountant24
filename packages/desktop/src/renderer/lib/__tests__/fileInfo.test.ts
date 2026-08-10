import { describe, expect, it } from "vitest";
import { fileKind, fileTypeLabel, formatFileSize } from "../fileInfo";

describe("fileTypeLabel()", () => {
  it("should return the uppercase extension for a regular filename", () => {
    expect(fileTypeLabel("07 Beleg.pdf")).toBe("PDF");
  });

  it("should use only the last extension of a multi-dot name", () => {
    expect(fileTypeLabel("archive.tar.gz")).toBe("GZ");
  });

  it("should return an empty string when the name has no extension", () => {
    expect(fileTypeLabel("README")).toBe("");
  });

  it("should not treat a leading dot as an extension", () => {
    expect(fileTypeLabel(".env")).toBe("");
  });

  it("should return an empty string for a trailing dot", () => {
    expect(fileTypeLabel("draft.")).toBe("");
  });

  it("should reject an implausibly long extension", () => {
    expect(fileTypeLabel("weird.notanextension")).toBe("");
  });

  it("should reject an extension with non-alphanumeric characters", () => {
    expect(fileTypeLabel("doc.p df")).toBe("");
  });
});

describe("fileKind()", () => {
  it("should classify csv as spreadsheet", () => {
    expect(fileKind("statement.csv")).toBe("spreadsheet");
  });

  it("should classify xlsx as spreadsheet", () => {
    expect(fileKind("Budget.XLSX")).toBe("spreadsheet");
  });

  it("should classify heic as image", () => {
    expect(fileKind("photo.heic")).toBe("image");
  });

  it("should classify pdf as document", () => {
    expect(fileKind("07 Beleg.pdf")).toBe("document");
  });

  it("should classify an extension-less name as document", () => {
    expect(fileKind("README")).toBe("document");
  });
});

describe("formatFileSize()", () => {
  it("should show bytes without decimals when below 1000", () => {
    expect(formatFileSize(532)).toBe("532 B");
  });

  it("should show 0 bytes as 0 B", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("should switch to KB at 1000 bytes", () => {
    expect(formatFileSize(1000)).toBe("1 KB");
  });

  it("should keep one decimal for small unit values", () => {
    expect(formatFileSize(1500)).toBe("1.5 KB");
  });

  it("should drop a trailing .0 decimal", () => {
    expect(formatFileSize(2000)).toBe("2 KB");
  });

  it("should drop decimals once the value reaches two digits", () => {
    expect(formatFileSize(245_000)).toBe("245 KB");
  });

  it("should round 9.95 up to the next integer instead of showing 10.0", () => {
    expect(formatFileSize(9_950)).toBe("10 KB");
  });

  it("should format megabytes with one decimal", () => {
    expect(formatFileSize(1_234_567)).toBe("1.2 MB");
  });

  it("should cap the unit at TB for huge values", () => {
    expect(formatFileSize(5_000_000_000_000_000)).toBe("5000 TB");
  });
});
