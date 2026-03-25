import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { z } from "zod";
import { LEDGER_DIR, MEMORY_PATH } from "../config.js";
import { HledgerCommandError, HledgerNotFoundError, hledgerCheck } from "./hledger.js";
import { MemorySchema } from "./update-memory.js";

const Params = Type.Object({});

export const validateTool: ToolDefinition<typeof Params, null> = {
  name: "validate",
  label: "Validate Workspace",
  description: "Validate the workspace: hledger check on the journal and memory.json schema. No parameters needed.",
  parameters: Params,
  async execute(_id, _params, signal) {
    const resolved = join(LEDGER_DIR, "main.journal");

    const results: string[] = [];
    const errors: string[] = [];

    // Journal validation
    try {
      await hledgerCheck(resolved, { signal });
      results.push("Ledger is valid.");
    } catch (e) {
      if (e instanceof HledgerNotFoundError) {
        results.push("hledger not found, skipped journal check.");
      } else if (e instanceof HledgerCommandError) {
        errors.push(`Ledger errors:\n${e.message}`);
      } else {
        throw e;
      }
    }

    // Memory validation
    if (existsSync(MEMORY_PATH)) {
      try {
        const raw = JSON.parse(readFileSync(MEMORY_PATH, "utf-8"));
        MemorySchema.parse(raw);
        results.push("Memory is valid.");
      } catch (e) {
        if (e instanceof z.ZodError) {
          const issues = e.issues.map((i) => `memory.json: ${i.path.join(".")}: ${i.message}`).join("\n");
          errors.push(issues);
        } else if (e instanceof SyntaxError) {
          errors.push("memory.json: invalid JSON");
        } else {
          errors.push(`memory.json: ${e}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error([...results, ...errors].join("\n"));
    }

    return {
      content: [{ type: "text", text: results.join(" ") }],
      details: null,
    };
  },
};
