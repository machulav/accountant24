import { beforeEach, describe, expect, it, vi } from "vitest";

// The tool is a thin wrapper over files/: resolveWorkspacePath (path-safety) +
// extractFile (the actual PDF/OCR extraction). Mock that boundary and assert the
// tool composes its output correctly and forwards the resolved path.
const resolveWorkspacePath = vi.hoisted(() => vi.fn((p: string) => `/ws/${p}`));
const extractFile = vi.hoisted(() => vi.fn());
vi.mock("../../files", () => ({ resolveWorkspacePath, extractFile }));

import { extractTextTool } from "../extract-text";

// The tool's public output shape (a single text content block + details). Typed
// here so tests can read `.text` without wrestling the TextContent|ImageContent
// union, and so the extra runtime `execute` args stay out of the call site.
type ToolTextResult = { content: { type: string; text: string }[]; details: Record<string, unknown> };
const run = (file_path: string): Promise<ToolTextResult> =>
  (extractTextTool.execute as unknown as (id: string, p: { file_path: string }) => Promise<ToolTextResult>)("id-1", {
    file_path,
  });

beforeEach(() => {
  resolveWorkspacePath.mockClear();
  extractFile.mockReset();
});

describe("extractTextTool.execute()", () => {
  it("should resolve the workspace-relative path through the safety helper", async () => {
    extractFile.mockResolvedValue({ mimeType: "application/pdf", text: "hi", pageCount: 1 });
    await run("files/2026/04/x.pdf");
    expect(resolveWorkspacePath).toHaveBeenCalledWith("files/2026/04/x.pdf");
    expect(extractFile).toHaveBeenCalledWith("/ws/files/2026/04/x.pdf");
  });

  it("should return the extracted text with a File/Type/Pages header for a PDF", async () => {
    extractFile.mockResolvedValue({ mimeType: "application/pdf", text: "line one\nline two", pageCount: 3 });
    const result = await run("files/x.pdf");
    const text = result.content[0].text;
    expect(text).toContain("File: files/x.pdf");
    expect(text).toContain("Type: application/pdf");
    expect(text).toContain("Pages: 3");
    expect(text).toContain("--- Extracted content ---");
    expect(text).toContain("line one\nline two");
  });

  it("should omit the Pages line when the result has no page count (an image)", async () => {
    extractFile.mockResolvedValue({ mimeType: "image/png", text: "receipt total 12.00" });
    const text = (await run("files/r.png")).content[0].text;
    expect(text).toContain("Type: image/png");
    expect(text).not.toContain("Pages:");
    expect(text).toContain("receipt total 12.00");
  });

  it("should carry the extraction details plus the original file path in details", async () => {
    extractFile.mockResolvedValue({ mimeType: "image/jpeg", text: "t" });
    const result = await run("files/a.jpg");
    expect(result.details).toMatchObject({ mimeType: "image/jpeg", text: "t", filePath: "files/a.jpg" });
  });

  it("should propagate an extraction failure (unsupported type) to the caller", async () => {
    extractFile.mockRejectedValue(new Error("Unsupported file type"));
    await expect(run("files/a.txt")).rejects.toThrow("Unsupported file type");
  });
});
