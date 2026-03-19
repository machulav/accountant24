import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { ACCOUNTANT24_HOME } from "../config.js";
import { resolveSafePath } from "./utils.js";

const MAX_SIZE = 100 * 1024;

const Params = Type.Object({
  path: Type.String({ description: "File path relative to ~/accountant24" }),
});

export const readTool: AgentTool<typeof Params, null> = {
  name: "read",
  label: "Read",
  description: "Read a file from the accountant24 workspace (~/accountant24).",
  parameters: Params,
  async execute(_id, params) {
    const resolved = resolveSafePath(params.path, ACCOUNTANT24_HOME);
    const file = Bun.file(resolved);

    if (!(await file.exists())) {
      throw new Error(`File not found: ${params.path}`);
    }

    let text = await file.text();
    let note = "";
    if (text.length > MAX_SIZE) {
      text = text.slice(0, MAX_SIZE);
      note = "\n\n[Truncated — file exceeds 100KB]";
    }

    return { content: [{ type: "text", text: text + note }], details: null };
  },
};
