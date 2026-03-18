import type { AgentTool } from "@mariozechner/pi-agent-core";
import { addTransactionTool } from "./add-transaction.js";
import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { queryTool } from "./query.js";
import { readTool } from "./read.js";
import { updateMemoryTool } from "./update-memory.js";
import { validateTool } from "./validate.js";
import { writeTool } from "./write.js";

export function createTools(): AgentTool[] {
  return [
    readTool,
    writeTool,
    editTool,
    bashTool,
    validateTool,
    queryTool,
    addTransactionTool,
    updateMemoryTool,
  ] as unknown as AgentTool[];
}
