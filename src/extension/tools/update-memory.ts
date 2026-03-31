import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { MEMORY_PATH } from "../config";
import { type SaveMemoryResult, saveMemory } from "../data";
import { createRenderCall, createRenderResult } from "./tool-renderer";

const Params = Type.Object({
  content: Type.String({
    description:
      "The complete updated contents of memory.md. " +
      "Merge new facts into existing content, organized by topic with ## headers and - bullet points. " +
      "Remove duplicates and outdated entries. Keep under 200 lines.",
  }),
});

const LABEL = "Update Memory";

export const updateMemoryTool: ToolDefinition<typeof Params, SaveMemoryResult> = {
  name: "update_memory",
  label: LABEL,
  description:
    "Rewrite memory.md with updated user preferences, rules, and knowledge. " +
    "Always include ALL existing facts (merged with new ones). " +
    "Organize by topic using headers (##) and bullet points (-).",
  parameters: Params,

  renderCall: createRenderCall({ label: LABEL }),

  async execute(_id, params) {
    const { content } = params;
    const result = saveMemory(content);

    return {
      content: [{ type: "text", text: "Memory updated." }],
      details: result,
    };
  },

  renderResult: createRenderResult<SaveMemoryResult>(({ details }) => [
    { heading: "Diff", content: details?.diff ?? "", type: "diff" },
    { heading: "File", content: MEMORY_PATH, type: "text" },
  ]),
};
