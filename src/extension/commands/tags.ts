import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { listTags } from "../data";

export function formatTags(tags: string[]): string {
  if (tags.length === 0) return "No tags found.";
  return `${["# Tags", "", ...tags.map((t) => `- ${t}`)].join("\n")}\n\n> **Tip:** Type \`@\` in the input field to quickly search and mention accounts, payees, and tags.`;
}

export function tagsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("tags", {
    description: "List all tags",
    handler: async () => {
      const tags = await listTags();
      pi.sendMessage({
        customType: "info",
        content: [{ type: "text", text: formatTags(tags) }],
        display: true,
      });
    },
  });
}
