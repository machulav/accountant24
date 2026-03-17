import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { MEMORY_PATH } from "../config.js";

const PayeeEntrySchema = z.object({
  account: z.string(),
  patterns: z.array(z.string()).optional(),
  notes: z.string().optional(),
}).strict();

const PayeesDataSchema = z.record(z.string(), PayeeEntrySchema);

const FactsDataSchema = z.array(z.string());

export const MemorySchema = z.object({
  facts: z.array(z.string()),
  payees: z.record(z.string(), PayeeEntrySchema),
}).strict();

const DEFAULT_MEMORY = { facts: [] as string[], payees: {} as Record<string, any> };

const Params = Type.Object({
  section: Type.Union(
    [Type.Literal("facts"), Type.Literal("payees")],
    {
      description: "Memory section to update: facts (user knowledge) or payees (payee mappings)",
    },
  ),
  data: Type.Any({
    description:
      'Data to merge. For "facts": string[] (appended to existing, deduplicated). For "payees": { "PayeeName": { account: string, patterns?: string[], notes?: string } }',
  }),
});

export const updateMemoryTool: AgentTool<typeof Params, null> = {
  name: "update_memory",
  label: "Update Memory",
  description:
    "Persist data to a section of memory.json (facts or payees). Use this to remember payee mappings and user knowledge.",
  parameters: Params,
  async execute(_id, params) {
    const memory = existsSync(MEMORY_PATH)
      ? JSON.parse(readFileSync(MEMORY_PATH, "utf-8"))
      : structuredClone(DEFAULT_MEMORY);

    let { section, data } = params;

    // LLMs sometimes pass data as a JSON string instead of an object
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        throw new Error(
          "Invalid data: expected a JSON object or array, got a non-parseable string.",
        );
      }
    }

    try {
      switch (section) {
        case "facts": {
          const newFacts = FactsDataSchema.parse(data);
          const existing = new Set(memory.facts ?? []);
          for (const f of newFacts) existing.add(f);
          memory.facts = [...existing];
          break;
        }
        case "payees":
          memory.payees = Object.assign(memory.payees ?? {}, PayeesDataSchema.parse(data));
          break;
      }
    } catch (e) {
      if (e instanceof z.ZodError) {
        const issues = e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(`Invalid data for section '${section}': ${issues}`);
      }
      throw e;
    }

    mkdirSync(dirname(MEMORY_PATH), { recursive: true });
    writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2) + "\n");

    return {
      content: [{ type: "text", text: `Updated memory section '${section}'.` }],
      details: null,
    };
  },
};
