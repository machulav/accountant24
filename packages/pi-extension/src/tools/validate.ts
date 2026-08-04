import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type ValidateLedgerResult, validateLedger } from "../ledger";
import { TOOL_LABELS } from "../tool-labels";

const Params = Type.Object({});

export const validateTool: ToolDefinition<typeof Params, ValidateLedgerResult> = {
  name: "validate",
  label: TOOL_LABELS.validate,
  description:
    "Check the ledger for errors. When it is valid, also tidies the journal files (sorts entries by date, normalizes formatting); the rewrite is proven meaning-preserving via hledger, and fully reverted otherwise.",
  promptSnippet: "Check the ledger for errors (also sorts and formats the journal files)",
  parameters: Params,

  async execute(_id, _params, signal) {
    const result = await validateLedger(signal);

    const lines = ["The ledger is valid."];
    if (result.tidy.changed > 0) {
      lines.push(`Sorted and formatted ${result.tidy.changed} journal file(s):`);
      for (const diff of result.tidy.diffs) {
        lines.push(`- ${diff.fullFilePath}`);
      }
    }
    if (result.tidy.skipped.length > 0) {
      lines.push("", "Entries left as written (outside the canonical format):");
      for (const skip of result.tidy.skipped) {
        lines.push(`- ${skip.fullFilePath}:${skip.startLine} — ${skip.reason}`);
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: result,
    };
  },
};
