import type { AgentTool } from "@mariozechner/pi-agent-core";
import { readFileTool } from "./read.js";
import { writeFileTool } from "./write.js";
import { executeTool } from "./bash.js";
import { validateTool } from "./validate.js";
import { queryTool } from "./query.js";
import { addTransactionTool } from "./add-transaction.js";
import { updateMemoryTool } from "./update-memory.js";

export function createTools(): AgentTool[] {
  return [
    readFileTool,
    writeFileTool,
    executeTool,
    validateTool,
    queryTool,
    addTransactionTool,
    updateMemoryTool,
  ] as unknown as AgentTool[];
}
