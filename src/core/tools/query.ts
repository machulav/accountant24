import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { LEDGER_DIR } from "../config.js";
import { resolveSafePath, runCommand } from "./utils.js";

const Params = Type.Object({
  query: Type.String({ description: "BQL query to execute (e.g. 'SELECT account, balance(position) GROUP BY 1')" }),
  file: Type.Optional(
    Type.String({ description: "Beancount file relative to ~/beanclaw/ledger (default: main.beancount)" }),
  ),
});

export const queryTool: AgentTool<typeof Params, null> = {
  name: "query",
  label: "Query Ledger",
  description: "Run a BQL query against a beancount ledger file using bean-query.",
  parameters: Params,
  async execute(_id, params, signal) {
    const file = params.file ?? "main.beancount";
    const resolved = resolveSafePath(file, LEDGER_DIR);

    const { exitCode, stdout, stderr } = await runCommand(
      ["bean-query", resolved, params.query],
      { signal },
    );

    if (exitCode === 127) {
      return {
        content: [{ type: "text", text: "bean-query not found. Install: pip install beanquery" }],
        details: null,
      };
    }

    if (exitCode === 0) {
      return { content: [{ type: "text", text: stdout || "(no results)" }], details: null };
    }

    const output = [stdout, stderr].filter(Boolean).join("\n");
    return { content: [{ type: "text", text: output }], details: null };
  },
};
