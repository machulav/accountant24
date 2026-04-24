import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { type ValidateLedgerResult, validateLedger } from "../ledger";
import { createRenderCall, createRenderResult } from "./tool-renderer";

const Params = Type.Object({});

const LABEL = "Validate Ledger";

export const validateTool: ToolDefinition<typeof Params, ValidateLedgerResult> = {
  name: "validate",
  label: LABEL,
  description: "Check the ledger for errors",
  promptSnippet: "Check the ledger for errors",
  parameters: Params,

  renderCall: createRenderCall({ label: LABEL }),

  async execute(_id, _params, signal) {
    const result = await validateLedger(signal);

    return {
      content: [{ type: "text", text: "The ledger is valid." }],
      details: result,
    };
  },

  renderResult: createRenderResult<ValidateLedgerResult>(() => [{ heading: "", content: "The ledger is valid." }]),
};
