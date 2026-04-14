import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const BASE = mkdtempSync(join(tmpdir(), "accountant24-file-extract-"));

import { mock } from "bun:test";

mock.module("../../config.js", () => ({
  ACCOUNTANT24_HOME: BASE,
  MEMORY_PATH: join(BASE, "memory.md"),
  LEDGER_DIR: join(BASE, "ledger"),
  FILES_DIR: join(BASE, "files"),
  setBaseDir: () => {},
}));

const { extractFile } = await import("../extract.js");

afterEach(() => {
  const filesDir = join(BASE, "files");
  if (existsSync(filesDir)) {
    rmSync(filesDir, { recursive: true, force: true });
  }
});

// Minimal valid PNG: 1x1 pixel, red
const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

// Minimal valid JPEG
const MINIMAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYI4Q/RFhHRUZ3ExdjKCY3Okk6T1dYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+gD/2Q==",
  "base64",
);

// Minimal valid PDF with enough text to pass the 50 chars/page threshold
const PDF_TEXT = "Date Description Amount Balance 2026-01-15 Grocery Store 45.00 USD 955.00 USD";
const PDF_STREAM = `BT /F1 10 Tf 50 700 Td (${PDF_TEXT}) Tj ET`;
const MINIMAL_PDF = Buffer.from(
  `%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${PDF_STREAM.length}>>
stream
${PDF_STREAM}
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f
0000000010 00000 n
0000000060 00000 n
0000000117 00000 n
0000000269 00000 n
0000000400 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
470
%%EOF`,
);

function createTestFile(name: string, content: Buffer): string {
  const dir = join(BASE, "input");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe("extractFile()", () => {
  describe("file not found", () => {
    test("should throw when file does not exist", async () => {
      await expect(extractFile("/nonexistent/file.pdf")).rejects.toThrow("File not found");
    });
  });

  describe("unsupported file type", () => {
    test("should throw for unsupported MIME type", async () => {
      const path = createTestFile("data.txt", Buffer.from("hello world"));
      await expect(extractFile(path)).rejects.toThrow("Unsupported file type");
    });

    test("should list supported formats in error message", async () => {
      const path = createTestFile("data.bin", Buffer.from([0x00, 0x01, 0x02]));
      await expect(extractFile(path)).rejects.toThrow("Unsupported file type");
    });
  });

  describe("image extraction", () => {
    test("should return text field for PNG file", async () => {
      const path = createTestFile("screenshot.png", MINIMAL_PNG);
      const result = await extractFile(path);

      expect(result.mimeType).toBe("image/png");
      expect(typeof result.text).toBe("string");
      expect(result.pageCount).toBeUndefined();
    });

    test("should return text field for JPEG file", async () => {
      const path = createTestFile("receipt.jpg", MINIMAL_JPEG);
      const result = await extractFile(path);

      expect(result.mimeType).toBe("image/jpeg");
      expect(typeof result.text).toBe("string");
    });

    test("should return empty string when OCR finds no text", async () => {
      const path = createTestFile("blank.png", MINIMAL_PNG);
      const result = await extractFile(path);

      expect(result.text).toBe("");
    });
  });

  describe("PDF extraction", () => {
    test("should extract text from text-based PDF", async () => {
      const path = createTestFile("statement.pdf", MINIMAL_PDF);
      const result = await extractFile(path);

      expect(result.mimeType).toBe("application/pdf");
      expect(result.pageCount).toBe(1);
      expect(result.text).toContain("Grocery Store");
    });

    test("should include page separators", async () => {
      const path = createTestFile("doc.pdf", MINIMAL_PDF);
      const result = await extractFile(path);

      expect(result.text).toContain("--- Page 1 ---");
    });

    test("should fall back to OCR for sparse-text PDFs", async () => {
      // PDF with "Hi" (2 chars) is below the 50 chars/page threshold
      const shortStream = "BT /F1 10 Tf 50 700 Td (Hi) Tj ET";
      const sparsePdf = Buffer.from(
        `%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${shortStream.length}>>
stream
${shortStream}
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f
0000000010 00000 n
0000000060 00000 n
0000000117 00000 n
0000000269 00000 n
0000000400 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
470
%%EOF`,
      );

      const path = createTestFile("scanned.pdf", sparsePdf);
      const result = await extractFile(path);

      expect(result.mimeType).toBe("application/pdf");
      expect(result.pageCount).toBe(1);
      expect(result.text).toContain("(OCR)");
    });

    test("should set pageCount for PDFs", async () => {
      const path = createTestFile("doc2.pdf", MINIMAL_PDF);
      const result = await extractFile(path);

      expect(result.pageCount).toBe(1);
    });

    test("should store original PDF file", async () => {
      const path = createTestFile("stored.pdf", MINIMAL_PDF);
      const result = await extractFile(path);

      expect(existsSync(result.storedPath)).toBe(true);
      expect(readFileSync(result.storedPath)).toEqual(MINIMAL_PDF);
    });
  });

  describe("file storage", () => {
    test("should store file in YYYY/MM directory", async () => {
      const path = createTestFile("statement.png", MINIMAL_PNG);
      const result = await extractFile(path);

      const now = new Date();
      const year = String(now.getFullYear());
      const month = String(now.getMonth() + 1).padStart(2, "0");

      expect(result.storedPath).toContain(join("files", year, month));
    });

    test("should prefix filename with timestamp", async () => {
      const path = createTestFile("statement.png", MINIMAL_PNG);
      const result = await extractFile(path);

      const now = new Date();
      const year = String(now.getFullYear());
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");

      expect(basename(result.storedPath)).toMatch(
        new RegExp(`^${year}-${month}-${day}_\\d{2}-\\d{2}-\\d{2}_statement\\.png$`),
      );
    });

    test("should preserve original file content", async () => {
      const path = createTestFile("original.png", MINIMAL_PNG);
      const result = await extractFile(path);

      expect(existsSync(result.storedPath)).toBe(true);
      expect(readFileSync(result.storedPath)).toEqual(MINIMAL_PNG);
    });

    test("should never overwrite previously stored files", async () => {
      const path = createTestFile("dup.png", MINIMAL_PNG);

      const result1 = await extractFile(path);
      const result2 = await extractFile(path);
      const result3 = await extractFile(path);

      // All three stored paths must be distinct
      const paths = new Set([result1.storedPath, result2.storedPath, result3.storedPath]);
      expect(paths.size).toBe(3);

      // All three files must exist
      expect(existsSync(result1.storedPath)).toBe(true);
      expect(existsSync(result2.storedPath)).toBe(true);
      expect(existsSync(result3.storedPath)).toBe(true);
    });
  });

  describe("result shape", () => {
    test("should include originalPath matching input", async () => {
      const path = createTestFile("test.png", MINIMAL_PNG);
      const result = await extractFile(path);

      expect(result.originalPath).toBe(path);
    });

    test("should include storedPath pointing to existing file", async () => {
      const path = createTestFile("test2.png", MINIMAL_PNG);
      const result = await extractFile(path);

      expect(result.storedPath).toBeTruthy();
      expect(existsSync(result.storedPath)).toBe(true);
    });

    test("should include text string in result", async () => {
      const path = createTestFile("test3.png", MINIMAL_PNG);
      const result = await extractFile(path);

      expect(typeof result.text).toBe("string");
    });

    test("should include mimeType in result", async () => {
      const path = createTestFile("test4.png", MINIMAL_PNG);
      const result = await extractFile(path);

      expect(result.mimeType).toBe("image/png");
    });
  });

  describe("extract_text tool integration", () => {
    test("should return formatted text content with metadata", async () => {
      const { extractTextTool } = await import("../../tools/extract-text.js");
      const path = createTestFile("tool-test.png", MINIMAL_PNG);

      const result = await extractTextTool.execute("id", { file_path: path }, undefined, undefined, {} as any);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("File:");
      expect(text).toContain("Stored:");
      expect(text).toContain("Type: image/png");
      expect(text).toContain("--- Extracted content ---");
      expect(text).not.toContain("Pages:");
    });

    test("should include page count for PDF files", async () => {
      const { extractTextTool } = await import("../../tools/extract-text.js");
      const path = createTestFile("tool-test.pdf", MINIMAL_PDF);

      const result = await extractTextTool.execute("id", { file_path: path }, undefined, undefined, {} as any);

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Pages: 1");
      expect(text).toContain("Grocery Store");
    });

    test("should render result sections when expanded", async () => {
      const { extractTextTool } = await import("../../tools/extract-text.js");
      const path = createTestFile("render-test.png", MINIMAL_PNG);
      const execResult = await extractTextTool.execute("id", { file_path: path }, undefined, undefined, {} as any);

      const mockTheme = { fg: (_: string, s: string) => s, bg: (_: string, s: string) => s, bold: (s: string) => s };
      const rendered = extractTextTool.renderResult?.(
        execResult,
        { expanded: true, isPartial: false },
        mockTheme as any,
        { isError: false } as any,
      );

      // When expanded, renderResult returns a renderable component (not empty text)
      expect(rendered).toBeDefined();
      expect(typeof (rendered as any).render).toBe("function");
    });

    test("should render result with Pages section for PDFs", async () => {
      const { extractTextTool } = await import("../../tools/extract-text.js");
      const path = createTestFile("render-pdf.pdf", MINIMAL_PDF);
      const execResult = await extractTextTool.execute("id", { file_path: path }, undefined, undefined, {} as any);

      const mockTheme = { fg: (_: string, s: string) => s, bg: (_: string, s: string) => s, bold: (s: string) => s };
      const rendered = extractTextTool.renderResult?.(
        execResult,
        { expanded: true, isPartial: false },
        mockTheme as any,
        { isError: false } as any,
      );

      // Render at a standard width and check output includes Pages
      const lines = (rendered as any).render(120) as string[];
      const text = lines.join("\n");
      expect(text).toContain("Pages");
      expect(text).toContain("Source");
      expect(text).toContain("Content");
    });

    test("should truncate long content preview in renderResult", async () => {
      const { extractTextTool } = await import("../../tools/extract-text.js");

      // Simulate a result with long text
      const longResult = {
        content: [{ type: "text" as const, text: "x" }],
        details: {
          storedPath: "/stored",
          originalPath: "/original",
          mimeType: "application/pdf",
          pageCount: 1,
          text: "A".repeat(600),
        },
      };

      const mockTheme = { fg: (_: string, s: string) => s, bg: (_: string, s: string) => s, bold: (s: string) => s };
      const rendered = extractTextTool.renderResult?.(
        longResult,
        { expanded: true, isPartial: false },
        mockTheme as any,
        { isError: false } as any,
      );

      const lines = (rendered as any).render(120) as string[];
      const text = lines.join("\n");
      expect(text).toContain("...");
    });

    test("should pass ExtractFileResult as details", async () => {
      const { extractTextTool } = await import("../../tools/extract-text.js");
      const path = createTestFile("tool-details.png", MINIMAL_PNG);

      const result = await extractTextTool.execute("id", { file_path: path }, undefined, undefined, {} as any);

      expect(result.details).toHaveProperty("storedPath");
      expect(result.details).toHaveProperty("originalPath");
      expect(result.details).toHaveProperty("mimeType");
      expect(result.details).toHaveProperty("text");
    });
  });

  describe("MIME detection", () => {
    test("should detect PNG from magic bytes", async () => {
      const path = createTestFile("noext", MINIMAL_PNG);
      const result = await extractFile(path);

      expect(result.mimeType).toBe("image/png");
    });

    test("should detect PDF from magic bytes", async () => {
      const path = createTestFile("noext2", MINIMAL_PDF);
      const result = await extractFile(path);

      expect(result.mimeType).toBe("application/pdf");
    });

    test("should detect JPEG from magic bytes", async () => {
      const path = createTestFile("noext3", MINIMAL_JPEG);
      const result = await extractFile(path);

      expect(result.mimeType).toBe("image/jpeg");
    });
  });
});
