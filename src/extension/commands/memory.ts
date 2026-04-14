import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getMemory } from "../memory";

export function formatMemory(memory: string): string {
  if (!memory) return "No memory found.";
  return `# Memory\n\n${memory}`;
}

export function memoryCommand(pi: ExtensionAPI): void {
  pi.registerCommand("memory", {
    description: "Show memory",
    handler: async () => {
      const memory = await getMemory();
      pi.sendMessage({
        customType: "info",
        content: [{ type: "text", text: formatMemory(memory) }],
        display: true,
      });
    },
  });
}
