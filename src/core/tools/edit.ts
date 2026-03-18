/**
 * Surgical file editing via exact text replacement.
 * Ported from pi-mono (packages/coding-agent/src/core/tools/edit.ts),
 * simplified for beanclaw's local-only use case.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { BEANCLAW_HOME } from "../config.js";
import {
  detectLineEnding,
  fuzzyFindText,
  generateDiffString,
  normalizeForFuzzyMatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./edit.utils.js";
import { resolveSafePath } from "./utils.js";

const Params = Type.Object({
  path: Type.String({ description: "File path relative to ~/beanclaw" }),
  oldText: Type.String({ description: "Exact text to find and replace (must match exactly including whitespace)" }),
  newText: Type.String({ description: "New text to replace the old text with" }),
});

export const editTool: AgentTool<typeof Params, null> = {
  name: "edit",
  label: "Edit",
  description:
    "Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
  parameters: Params,
  async execute(_id, params, signal) {
    const resolved = resolveSafePath(params.path, BEANCLAW_HOME);
    const file = Bun.file(resolved);

    if (!(await file.exists())) {
      throw new Error(`File not found: ${params.path}`);
    }

    if (signal?.aborted) throw new Error("Operation aborted");

    const rawContent = await file.text();
    const { bom, text: content } = stripBom(rawContent);

    const originalEnding = detectLineEnding(content);
    const normalizedContent = normalizeToLF(content);
    const normalizedOldText = normalizeToLF(params.oldText);
    const normalizedNewText = normalizeToLF(params.newText);

    // Find the old text (exact first, then fuzzy)
    const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);

    if (!matchResult.found) {
      throw new Error(
        `Could not find the exact text in ${params.path}. The old text must match exactly including all whitespace and newlines.`,
      );
    }

    // Reject if multiple occurrences
    const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
    const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
    const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;

    if (occurrences > 1) {
      throw new Error(
        `Found ${occurrences} occurrences of the text in ${params.path}. The text must be unique. Please provide more context to make it unique.`,
      );
    }

    if (signal?.aborted) throw new Error("Operation aborted");

    // Perform replacement
    const baseContent = matchResult.contentForReplacement;
    const newContent =
      baseContent.substring(0, matchResult.index) +
      normalizedNewText +
      baseContent.substring(matchResult.index + matchResult.matchLength);

    if (baseContent === newContent) {
      throw new Error(`No changes made to ${params.path}. The replacement produced identical content.`);
    }

    const finalContent = bom + restoreLineEndings(newContent, originalEnding);
    await Bun.write(resolved, finalContent);

    const { diff } = generateDiffString(baseContent, newContent);
    return {
      content: [{ type: "text", text: `Edited ${params.path}\n\n${diff}` }],
      details: null,
    };
  },
};
