import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { ACCOUNTANT24_HOME } from "../config.js";
import { resolveSafePath } from "./utils.js";

const Params = Type.Object({
  path: Type.String({ description: "File path relative to ~/accountant24" }),
  content: Type.String({ description: "Content to write" }),
});

export const writeTool: AgentTool<typeof Params, null> = {
  name: "write",
  label: "Write",
  description:
    "Write content to a file in the accountant24 workspace (~/accountant24). Creates parent directories as needed.",
  parameters: Params,
  async execute(_id, params) {
    const resolved = resolveSafePath(params.path, ACCOUNTANT24_HOME);
    mkdirSync(dirname(resolved), { recursive: true });
    const bytes = await Bun.write(resolved, params.content);
    return { content: [{ type: "text", text: `Wrote ${bytes} bytes to ${params.path}` }], details: null };
  },
};
