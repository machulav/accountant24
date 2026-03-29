import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { listAccounts } from "../data";

export function accountsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("accounts", {
    description: "List all accounts",
    handler: async () => {
      const accounts = await listAccounts();
      pi.sendMessage({
        customType: "info",
        content: [{ type: "text", text: accounts.length > 0 ? accounts.join("\n") : "No accounts found." }],
        display: true,
      });
    },
  });
}
