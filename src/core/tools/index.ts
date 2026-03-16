import type { AgentTool } from "@mariozechner/pi-agent-core";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { executeTool } from "./execute.js";
import { validateTool } from "./validate.js";
import { queryTool } from "./query.js";
import { addTransactionTool } from "./add-transaction.js";
import { updateMemoryTool } from "./update-memory.js";

export function createTools(): AgentTool[] {
  return [readFileTool, writeFileTool, executeTool, validateTool, queryTool, addTransactionTool, updateMemoryTool] as unknown as AgentTool[];
}
