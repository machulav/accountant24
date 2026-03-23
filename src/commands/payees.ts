import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadSystemPromptContext } from "../system-prompt.js";

export function payeesCommand(pi: ExtensionAPI): void {
  pi.registerCommand("payees", {
    description: "List all payees",
    handler: async () => {
      const { payees } = await loadSystemPromptContext();
      pi.sendMessage({
        customType: "info",
        content: [{ type: "text", text: payees.length > 0 ? payees.join("\n") : "No payees found." }],
        display: true,
      });
    },
  });
}
