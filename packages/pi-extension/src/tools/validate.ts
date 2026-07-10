import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type ValidateLedgerResult, validateLedger } from "../ledger";
import { TOOL_LABELS } from "../tool-labels";

const Params = Type.Object({});

export const validateTool: ToolDefinition<typeof Params, ValidateLedgerResult> = {
  name: "validate",
  label: TOOL_LABELS.validate,
  description: "Check the ledger for errors",
  promptSnippet: "Check the ledger for errors",
  parameters: Params,

  async execute(_id, _params, signal) {
    const result = await validateLedger(signal);

    return {
      content: [{ type: "text", text: "The ledger is valid." }],
      details: result,
    };
  },
};
