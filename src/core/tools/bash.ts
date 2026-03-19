import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { ACCOUNTANT24_HOME } from "../config.js";
import { runCommand } from "./utils.js";

const Params = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
});

export const bashTool: AgentTool<typeof Params, null> = {
  name: "bash",
  label: "Bash",
  description: "Execute a shell command in the accountant24 workspace (~/accountant24).",
  parameters: Params,
  async execute(_id, params, signal) {
    const { exitCode, stdout, stderr } = await runCommand(["sh", "-c", params.command], {
      cwd: ACCOUNTANT24_HOME,
      signal,
    });

    const parts = [`Exit code: ${exitCode}`];
    if (stdout) parts.push(`stdout:\n${stdout}`);
    if (stderr) parts.push(`stderr:\n${stderr}`);
    const text = parts.join("\n");

    return { content: [{ type: "text", text }], details: null };
  },
};
