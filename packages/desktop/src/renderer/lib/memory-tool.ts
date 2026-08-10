// The agent maintains memory.md with pi's generic file tools (there is no
// dedicated memory tool). The renderer has no workspace path, so memory calls
// are recognized by the tool-call target path alone. A miss is cosmetic (the
// call renders with the generic Edit/Write/Read label), never broken.
function isMemoryFilePath(args: unknown): boolean {
  const { path, file_path } = (args ?? {}) as { path?: unknown; file_path?: unknown };
  const raw = path ?? file_path;
  if (typeof raw !== "string") return false;
  const normalized = raw.replace(/\\/g, "/");
  return normalized === "memory.md" || normalized.endsWith("/memory.md");
}

export function isMemoryUpdateCall(toolName: string, args: unknown): boolean {
  return (toolName === "edit" || toolName === "write") && isMemoryFilePath(args);
}

export function isMemoryReadCall(toolName: string, args: unknown): boolean {
  return toolName === "read" && isMemoryFilePath(args);
}
