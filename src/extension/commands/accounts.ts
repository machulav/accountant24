import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadAccounts } from "../context";

export function accountsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("accounts", {
    description: "List all accounts",
    handler: async () => {
      const accounts = await loadAccounts();
      pi.sendMessage({
        customType: "info",
        content: [{ type: "text", text: accounts.length > 0 ? accounts.join("\n") : "No accounts found." }],
        display: true,
      });
    },
  });
}
