import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { LEDGER_DIR } from "../config.js";
import { HledgerCommandError, HledgerNotFoundError, hledgerCheck } from "./hledger.js";
import { resolveSafePath } from "./utils.js";

const Params = Type.Object({});

export const validateTool: ToolDefinition<typeof Params, null> = {
  name: "validate",
  label: "Validate Ledger",
  description: "Run hledger check on the journal. No parameters needed.",
  parameters: Params,
  async execute(_id, _params, signal) {
    const resolved = resolveSafePath("main.journal", LEDGER_DIR);

    try {
      await hledgerCheck(resolved, { signal });
    } catch (e) {
      if (e instanceof HledgerNotFoundError) {
        return {
          content: [{ type: "text", text: "hledger not found, skipped journal check." }],
          details: null,
        };
      }
      if (e instanceof HledgerCommandError) {
        throw new Error(`Ledger errors:\n${e.message}`);
      }
      throw e;
    }

    return {
      content: [{ type: "text", text: "Ledger is valid." }],
      details: null,
    };
  },
};
