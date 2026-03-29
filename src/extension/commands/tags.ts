import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadTags } from "../context";

export function tagsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("tags", {
    description: "List all tags",
    handler: async () => {
      const tags = await loadTags();
      pi.sendMessage({
        customType: "info",
        content: [{ type: "text", text: tags.length > 0 ? tags.join("\n") : "No tags found." }],
        display: true,
      });
    },
  });
}
