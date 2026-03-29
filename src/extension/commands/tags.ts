import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { listTags } from "../data";

export function tagsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("tags", {
    description: "List all tags",
    handler: async () => {
      const tags = await listTags();
      pi.sendMessage({
        customType: "info",
        content: [{ type: "text", text: tags.length > 0 ? tags.join("\n") : "No tags found." }],
        display: true,
      });
    },
  });
}
