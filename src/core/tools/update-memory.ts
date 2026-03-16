import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { MEMORY_PATH } from "../config.js";

const DEFAULT_MEMORY = { user: { facts: [] as string[] }, payees: {} as Record<string, any>, rules: [] as any[] };

const Params = Type.Object({
  section: Type.Union([Type.Literal("user"), Type.Literal("payees"), Type.Literal("rules")], {
    description: "Memory section to update: user (profile/facts), payees (payee mappings), or rules (classification rules)",
  }),
  data: Type.Any({ description: "Data to merge into the section" }),
});

export const updateMemoryTool: AgentTool<typeof Params, null> = {
  name: "update_memory",
  label: "Update Memory",
  description: "Persist data to a section of memory.json (user, payees, or rules). Use this to remember payee mappings, user preferences, and classification rules.",
  parameters: Params,
  async execute(_id, params) {
    const memory = existsSync(MEMORY_PATH)
      ? JSON.parse(readFileSync(MEMORY_PATH, "utf-8"))
      : structuredClone(DEFAULT_MEMORY);

    const { section, data } = params;

    switch (section) {
      case "user":
        memory.user = Object.assign(memory.user ?? {}, data);
        break;
      case "payees":
        memory.payees = Object.assign(memory.payees ?? {}, data);
        break;
      case "rules":
        memory.rules = data;
        break;
    }

    mkdirSync(dirname(MEMORY_PATH), { recursive: true });
    writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2) + "\n");

    return { content: [{ type: "text", text: `Updated memory section '${section}'.` }], details: null };
  },
};
