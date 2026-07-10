import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type ExtractFileResult, extractFile, resolveWorkspacePath } from "../files";
import { TOOL_LABELS } from "../tool-labels";

const Params = Type.Object({
  file_path: Type.String({
    description:
      "Workspace-relative path to the file (e.g., files/2026/04/20260417160112_file.pdf). Do not use absolute paths.",
  }),
});

export const extractTextTool: ToolDefinition<typeof Params, ExtractFileResult> = {
  name: "extract_text",
  label: TOOL_LABELS.extract_text,
  description:
    "Extract text content from a file (PDF, PNG, JPEG). For PDFs, extracts text directly; for scanned PDFs and images, uses OCR.",
  promptSnippet: "Extract text from PDF/image files via OCR",
  promptGuidelines: [
    "Use extract_text when the user provides a file path to a bank statement, invoice, receipt, screenshot, or any document containing financial data.",
    "After extract_text returns content, use add_transactions to record the identified transactions.",
  ],
  parameters: Params,

  async execute(_id, params) {
    const absolutePath = resolveWorkspacePath(params.file_path);
    const result = await extractFile(absolutePath);

    const lines = [`File: ${params.file_path}`, `Type: ${result.mimeType}`];
    if (result.pageCount) {
      lines.push(`Pages: ${result.pageCount}`);
    }
    lines.push("", "--- Extracted content ---", "", result.text);

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: { ...result, filePath: params.file_path },
    };
  },
};
