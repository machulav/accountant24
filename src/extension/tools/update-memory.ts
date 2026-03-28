import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { MEMORY_PATH } from "../config.js";

const Params = Type.Object({
  content: Type.String({
    description:
      "The complete updated contents of memory.md. " +
      "Merge new facts into existing content, organized by topic with ## headers and - bullet points. " +
      "Remove duplicates and outdated entries. Keep under 200 lines.",
  }),
});

export const updateMemoryTool: ToolDefinition<typeof Params, null> = {
  name: "update_memory",
  label: "Update Memory",
  description:
    "Rewrite memory.md with updated user preferences, rules, and knowledge. " +
    "Always include ALL existing facts (merged with new ones). " +
    "Organize by topic using headers (##) and bullet points (-).",
  parameters: Params,
  async execute(_id, params) {
    const { content } = params;

    mkdirSync(dirname(MEMORY_PATH), { recursive: true });
    writeFileSync(MEMORY_PATH, `${content.trim()}\n`);

    return {
      content: [{ type: "text", text: "Memory updated." }],
      details: null,
    };
  },
};
