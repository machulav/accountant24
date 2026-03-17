import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { LEDGER_DIR, MEMORY_PATH } from "../config.js";
import { runCommand } from "./utils.js";
import { MemorySchema } from "./update-memory.js";
import { join } from "node:path";

const Params = Type.Object({});

export const validateTool: AgentTool<typeof Params, null> = {
  name: "validate",
  label: "Validate Workspace",
  description:
    "Validate the workspace: hledger check on the journal and memory.json schema. No parameters needed.",
  parameters: Params,
  async execute(_id, _params, signal) {
    const resolved = join(LEDGER_DIR, "main.journal");

    const results: string[] = [];
    const errors: string[] = [];

    // Journal validation
    const { exitCode, stdout, stderr } = await runCommand(
      ["hledger", "check", "--strict", "-f", resolved],
      { signal },
    );

    if (exitCode === 127) {
      results.push("hledger not found, skipped journal check.");
    } else if (exitCode === 0) {
      results.push("Ledger is valid.");
    } else {
      const output = [stdout, stderr].filter(Boolean).join("\n");
      errors.push(`Ledger errors:\n${output}`);
    }

    // Memory validation
    if (existsSync(MEMORY_PATH)) {
      try {
        const raw = JSON.parse(readFileSync(MEMORY_PATH, "utf-8"));
        MemorySchema.parse(raw);
        results.push("Memory is valid.");
      } catch (e) {
        if (e instanceof z.ZodError) {
          const issues = e.issues
            .map((i) => `memory.json: ${i.path.join(".")}: ${i.message}`)
            .join("\n");
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
