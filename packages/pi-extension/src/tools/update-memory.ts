import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type SaveMemoryResult, saveMemory } from "../memory";
import { TOOL_LABELS } from "../tool-labels";

const Params = Type.Object({
  content: Type.String({
    description:
      "The complete updated contents of memory.md. " +
      "Merge new facts into existing content, organized by topic with ## headers and - bullet points. " +
      "Remove duplicates and outdated entries. Keep under 200 lines.",
  }),
});

export const updateMemoryTool: ToolDefinition<typeof Params, SaveMemoryResult> = {
  name: "update_memory",
  label: TOOL_LABELS.update_memory,
  description:
    "Rewrite memory.md with updated user preferences, rules, and knowledge. " +
    "Always include ALL existing facts (merged with new ones). " +
    "Organize by topic using headers (##) and bullet points (-).",
  promptSnippet: "Save user preferences and facts to persistent memory",
  promptGuidelines: [
    "Use update_memory to store: personal facts, preferences, explicit categorization rules, and recurring arrangement details.",
    "Transaction-specific context belongs in the transaction description, not in update_memory.",
  ],
  parameters: Params,

  async execute(_id, params) {
    const { content } = params;
    const result = saveMemory(content);

    return {
      content: [{ type: "text", text: "Memory updated." }],
      details: result,
    };
  },
};
