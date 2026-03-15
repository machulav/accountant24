import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { LEDGER_DIR } from "../config.js";
import { resolveSafePath, runCommand } from "./utils.js";

const Params = Type.Object({
  file: Type.Optional(
    Type.String({ description: "Beancount file relative to ~/beanclaw/ledger (default: main.beancount)" }),
  ),
});

export const validateTool: AgentTool<typeof Params, null> = {
  name: "validate",
  label: "Validate Ledger",
  description: "Run bean-check to validate a beancount ledger file.",
  parameters: Params,
  async execute(_id, params, signal) {
    const file = params.file ?? "main.beancount";
    const resolved = resolveSafePath(file, LEDGER_DIR);

    const { exitCode, stdout, stderr } = await runCommand(["bean-check", resolved], { signal });

    if (exitCode === 127) {
      return {
        content: [{ type: "text", text: "bean-check not found. Install beancount: pip install beancount" }],
        details: null,
      };
    }

    if (exitCode === 0) {
      return { content: [{ type: "text", text: "Ledger is valid." }], details: null };
    }

    const output = [stdout, stderr].filter(Boolean).join("\n");
    return { content: [{ type: "text", text: output }], details: null };
  },
};
