import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { BEANCLAW_HOME } from "../config.js";
import { resolveSafePath, runCommand } from "./utils.js";

const Params = Type.Object({
  file: Type.Optional(
    Type.String({ description: "Journal file relative to ~/beanclaw (default: ledger/main.journal)" }),
  ),
});

export const validateTool: AgentTool<typeof Params, null> = {
  name: "validate",
  label: "Validate Ledger",
  description: "Run hledger check on a journal file.",
  parameters: Params,
  async execute(_id, params, signal) {
    const file = params.file ?? "ledger/main.journal";
    const resolved = resolveSafePath(file, BEANCLAW_HOME);

    const { exitCode, stdout, stderr } = await runCommand(
      ["hledger", "check", "--strict", "-f", resolved],
      { signal },
    );

    if (exitCode === 127) {
      throw new Error("hledger not found. Install: https://hledger.org/install");
    }

    if (exitCode === 0) {
      return { content: [{ type: "text", text: "Ledger is valid." }], details: null };
    }

    const output = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(output);
  },
};
