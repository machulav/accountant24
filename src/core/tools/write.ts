import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { BEANCLAW_HOME } from "../config.js";
import { resolveSafePath } from "./utils.js";

const Params = Type.Object({
  path: Type.String({ description: "File path relative to ~/beanclaw" }),
  content: Type.String({ description: "Content to write" }),
});

export const writeTool: AgentTool<typeof Params, null> = {
  name: "write",
  label: "Write",
  description: "Write content to a file in the beanclaw workspace (~/beanclaw). Creates parent directories as needed.",
  parameters: Params,
  async execute(_id, params) {
    const resolved = resolveSafePath(params.path, BEANCLAW_HOME);
    mkdirSync(dirname(resolved), { recursive: true });
    const bytes = await Bun.write(resolved, params.content);
    return { content: [{ type: "text", text: `Wrote ${bytes} bytes to ${params.path}` }], details: null };
  },
};
