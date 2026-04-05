import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type ExtractFileResult, extractFile } from "../data";
import { createRenderCall, createRenderResult } from "./tool-renderer";

const Params = Type.Object({
  file_path: Type.String({
    description: "Absolute path to the file to extract text from (PDF, PNG, JPEG)",
  }),
});

const LABEL = "Extract Text";

export const extractTextTool: ToolDefinition<typeof Params, ExtractFileResult> = {
  name: "extract_text",
  label: LABEL,
  description:
    "Extract text content from a file (PDF, PNG, JPEG). For PDFs, extracts text directly; for scanned PDFs and images, uses OCR. " +
    "Stores the original file in the workspace for future reference.",
  promptSnippet: "extract_text — extract text from PDFs and images (with OCR for scanned documents)",
  promptGuidelines: [
    "Use extract_text when the user provides a file path to a bank statement, invoice, receipt, screenshot, or any document containing financial data.",
    "The tool returns extracted text content directly. Analyze the text to identify transactions.",
    "After analyzing, use add_transaction to record the extracted transactions.",
  ],
  parameters: Params,

  renderCall: createRenderCall({ label: LABEL }),

  async execute(_id, params) {
    const result = await extractFile(params.file_path);

    const lines = [`File: ${result.originalPath}`, `Stored: ${result.storedPath}`, `Type: ${result.mimeType}`];
    if (result.pageCount) {
      lines.push(`Pages: ${result.pageCount}`);
    }
    lines.push("", "--- Extracted content ---", "", result.text);

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      details: result,
    };
  },

  renderResult: createRenderResult<ExtractFileResult>(({ details }) => {
    const sections = [
      { heading: "Source", content: details?.originalPath ?? "" },
      { heading: "Stored", content: details?.storedPath ?? "" },
      { heading: "Type", content: details?.mimeType ?? "" },
    ];
    if (details?.pageCount) {
      sections.push({ heading: "Pages", content: String(details.pageCount) });
    }
    const text = details?.text ?? "";
    const preview = text.length > 500 ? `${text.slice(0, 500)}...` : text;
    if (preview) {
      sections.push({ heading: "Content", content: preview });
    }
    return sections;
  }),
};
