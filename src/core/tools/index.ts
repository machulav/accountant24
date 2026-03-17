import type { AgentTool } from "@mariozechner/pi-agent-core";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { bashTool } from "./bash.js";
import { validateTool } from "./validate.js";
import { queryTool } from "./query.js";
import { addTransactionTool } from "./add-transaction.js";
import { updateMemoryTool } from "./update-memory.js";

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
