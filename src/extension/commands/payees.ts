import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { listPayees } from "../data";

export function formatPayees(payees: string[]): string {
  if (payees.length === 0) return "No payees found.";
  return `${["# Payees", "", ...payees.map((p) => `- ${p}`)].join("\n")}\n\n> **Tip:** Type \`@\` in the input field to quickly search and mention accounts, payees, and tags.`;
}

export function payeesCommand(pi: ExtensionAPI): void {
  pi.registerCommand("payees", {
    description: "List all payees",
    handler: async () => {
      const payees = await listPayees();
      pi.sendMessage({
        customType: "info",
        content: [{ type: "text", text: formatPayees(payees) }],
        display: true,
      });
    },
  });
}
