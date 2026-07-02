import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type ValidateLedgerResult, validateLedger } from "../ledger";

const Params = Type.Object({});

const LABEL = "Validate Ledger";

export const validateTool: ToolDefinition<typeof Params, ValidateLedgerResult> = {
  name: "validate",
  label: LABEL,
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
