import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { BEANCLAW_HOME } from "../config.js";
import { runCommand } from "./utils.js";

const Params = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
});

export const executeTool: AgentTool<typeof Params, null> = {
  name: "execute",
  label: "Execute Command",
  description: "Execute a shell command in the beanclaw workspace (~/beanclaw).",
  parameters: Params,
  async execute(_id, params, signal) {
    const { exitCode, stdout, stderr } = await runCommand(
      ["sh", "-c", params.command],
      { cwd: BEANCLAW_HOME, signal },
    );

    const parts = [`Exit code: ${exitCode}`];
    if (stdout) parts.push(`stdout:\n${stdout}`);
    if (stderr) parts.push(`stderr:\n${stderr}`);

    return { content: [{ type: "text", text: parts.join("\n") }], details: null };
  },
};
