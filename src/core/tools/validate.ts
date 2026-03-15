import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { BEANCLAW_HOME } from "../config.js";
import { resolveSafePath, runCommand } from "./utils.js";

const Params = Type.Object({
  file: Type.Optional(
    Type.String({ description: "Beancount file relative to ~/beanclaw (default: ledger/main.beancount)" }),
  ),
});

export const validateTool: AgentTool<typeof Params, null> = {
  name: "validate",
  label: "Validate Ledger",
  description: "Run bean-check to validate a beancount ledger file.",
  parameters: Params,
  async execute(_id, params, signal) {
    const file = params.file ?? "ledger/main.beancount";
    const resolved = resolveSafePath(file, BEANCLAW_HOME);

    const { exitCode, stdout, stderr } = await runCommand(["bean-check", resolved], { signal });

    if (exitCode === 127) {
      throw new Error("bean-check not found. Install beancount: pip install beancount");
    }

    if (exitCode === 0) {
      return { content: [{ type: "text", text: "Ledger is valid." }], details: null };
    }

    const output = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(output);
  },
};
