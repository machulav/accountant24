import { isToolCallEventType, type ToolCallEvent, type ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { getMemory } from "./memory";
import { isMemoryFilePath } from "./paths";

// memory.md is maintained with pi's built-in `edit` tool (granular,
// diff-visible updates). This guard enforces the two rules the system prompt
// alone cannot guarantee: no wholesale rewrites via `write` once memory has
// content, and no bash access to the file.
export async function guardMemoryToolCall(event: ToolCallEvent, cwd: string): Promise<ToolCallEventResult | undefined> {
  if (isToolCallEventType("write", event) && isMemoryFilePath(event.input.path, cwd)) {
    const memory = await getMemory();
    // The first save into an empty memory file is a creation, not a rewrite.
    if (memory !== "") {
      return {
        block: true,
        reason:
          "memory.md already has content. Do not rewrite it wholesale. " +
          "Use the edit tool with targeted oldText/newText replacements that change only the affected lines. " +
          "The current memory is in the <memory> block of the system prompt.",
      };
    }
  }

  if (
    isToolCallEventType("bash", event) &&
    typeof event.input.command === "string" &&
    event.input.command.includes("memory.md")
  ) {
    return {
      block: true,
      reason:
        "Do not access memory.md with bash. " +
        "The current memory is in the <memory> block of the system prompt; modify it with the edit tool.",
    };
  }

  return undefined;
}
