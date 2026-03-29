import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { validateLedger } from "../data";

const Params = Type.Object({});

export const validateTool: ToolDefinition<typeof Params, null> = {
  name: "validate",
  label: "Validate Ledger",
  description: "Run hledger check on the journal. No parameters needed.",
  parameters: Params,
  async execute(_id, _params, signal) {
    const status = await validateLedger(signal);

    return {
      content: [{ type: "text", text: status }],
      details: null,
    };
  },
};
