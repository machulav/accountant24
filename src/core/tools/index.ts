import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { addTransactionTool } from "./add-transaction.js";
import { queryTool } from "./query.js";
import { updateMemoryTool } from "./update-memory.js";
import { validateTool } from "./validate.js";

export function createCustomTools(): ToolDefinition[] {
  return [validateTool, queryTool, addTransactionTool, updateMemoryTool] as unknown as ToolDefinition[];
}
