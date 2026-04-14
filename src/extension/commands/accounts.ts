import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { listAccounts } from "../ledger";

const ACCOUNT_TYPES = [
  { type: "assets", label: "Assets", description: "Things you own (bank accounts, cash, investments)" },
  { type: "liabilities", label: "Liabilities", description: "Things you owe (credit cards, loans, mortgages)" },
  { type: "equity", label: "Equity", description: "Owner's investment, balances assets and liabilities" },
  { type: "income", label: "Income", description: "Inflows of money (salary, business, interest)" },
  { type: "expenses", label: "Expenses", description: "Outflows of money (rent, groceries, subscriptions)" },
] as const;

export function formatAccounts(accounts: string[]): string {
  if (accounts.length === 0) return "No accounts found.";

  const groups = new Map<string, string[]>();
  const other: string[] = [];

  for (const account of accounts) {
    const colonIdx = account.indexOf(":");
    if (colonIdx === -1) {
      other.push(account);
      continue;
    }
    const type = account.slice(0, colonIdx).toLowerCase();
    if (ACCOUNT_TYPES.some((t) => t.type === type)) {
      const list = groups.get(type) ?? [];
      if (!groups.has(type)) groups.set(type, list);
      list.push(account);
    } else {
      other.push(account);
    }
  }

  const lines: string[] = ["# Accounts", ""];

  // Type legend at the top, like accounts.journal header
  const presentTypes = ACCOUNT_TYPES.filter(({ type }) => groups.has(type));
  const maxLabelLen = Math.max(...presentTypes.map(({ label }) => label.length), other.length > 0 ? 5 : 0);
  lines.push("> Account types:");
  for (const { label, description } of presentTypes) {
    lines.push(`>   **${label}**${" ".repeat(maxLabelLen - label.length)}  — ${description.toLowerCase()}`);
  }
  if (other.length > 0) {
    lines.push(`>   **Other**${" ".repeat(maxLabelLen - 5)}  — uncategorized accounts`);
  }
  lines.push("");

  for (const { type, label } of ACCOUNT_TYPES) {
    const items = groups.get(type);
    if (!items || items.length === 0) continue;

    lines.push(`## ${label}`, "");

    if (type === "expenses") {
      let prevSubcategory = "";
      for (const item of items) {
        const parts = item.split(":");
        const subcategory = parts.length >= 3 ? parts[1] : item;
        if (prevSubcategory && subcategory !== prevSubcategory) {
          lines.push("");
        }
        prevSubcategory = subcategory;
        lines.push(`- ${item}`);
      }
    } else {
      for (const item of items) {
        lines.push(`- ${item}`);
      }
    }

    lines.push("");
  }

  if (other.length > 0) {
    lines.push("## Other", "");
    for (const item of other) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  while (lines[lines.length - 1] === "") lines.pop();

  return `${lines.join("\n")}\n\n> **Tip:** Type \`@\` in the input field to quickly search and mention accounts, payees, and tags.`;
}

export function accountsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("accounts", {
    description: "List all accounts",
    handler: async () => {
      const accounts = await listAccounts();
      pi.sendMessage({
        customType: "info",
        content: [{ type: "text", text: formatAccounts(accounts) }],
        display: true,
      });
    },
  });
}
