import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { z } from "zod";
import { MEMORY_PATH } from "../config.js";

const FactsDataSchema = z.array(z.string());

export const MemorySchema = z
  .object({
    facts: z.array(z.string()),
  })
  .strict();

const DEFAULT_MEMORY = { facts: [] as string[] };

const Params = Type.Object({
  facts: Type.Array(Type.String(), {
    description: "Array of facts to add to memory (appended, deduplicated)",
  }),
});

export const updateMemoryTool: AgentTool<typeof Params, null> = {
  name: "update_memory",
  label: "Update Memory",
  description: "Persist facts to memory.json. Use to remember user preferences, rules, and knowledge.",
  parameters: Params,
  async execute(_id, params) {
    const raw = existsSync(MEMORY_PATH)
      ? JSON.parse(readFileSync(MEMORY_PATH, "utf-8"))
      : structuredClone(DEFAULT_MEMORY);
    delete raw.payees; // drop legacy key

    let { facts } = params;

    // LLMs sometimes pass data as a JSON string instead of an array
    if (typeof facts === "string") {
      try {
        facts = JSON.parse(facts);
      } catch {
        throw new Error("Invalid facts: expected a JSON array of strings, got a non-parseable string.");
      }
    }

    try {
      const newFacts = FactsDataSchema.parse(facts);
      const existing = new Set(raw.facts ?? []);
      for (const f of newFacts) existing.add(f);
      raw.facts = [...existing];
    } catch (e) {
      if (e instanceof z.ZodError) {
        const issues = e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(`Invalid facts: ${issues}`);
      }
      throw e;
    }

    mkdirSync(dirname(MEMORY_PATH), { recursive: true });
    writeFileSync(MEMORY_PATH, JSON.stringify({ facts: raw.facts }, null, 2) + "\n");

    return {
      content: [{ type: "text", text: "Updated memory." }],
      details: null,
    };
  },
};
