// Tool presentation for ACP clients: the human label and the ACP "kind" that
// drives a client's icon and grouping (Zed renders an edit differently from a
// search).
//
// The labels are deliberately DUPLICATED from packages/pi-extension/src/tool-labels.ts
// so this node-side module never imports the agent package — the same rule the
// renderer copy follows. __tests__/tools.test.ts asserts all three maps agree,
// so a rename in one place fails the build rather than drifting silently.

import type { ToolKind } from "@agentclientprotocol/sdk";

interface ToolPresentation {
  label: string;
  kind: ToolKind;
}

/** The accountant24 extension's own tools. */
export const EXTENSION_TOOLS: Record<string, ToolPresentation> = {
  query: { label: "Query Ledger", kind: "search" },
  add_transactions: { label: "Add Transactions", kind: "edit" },
  add_balance_assertions: { label: "Add Balance Assertions", kind: "edit" },
  add_prices: { label: "Add Prices", kind: "edit" },
  extract_text: { label: "Extract Text", kind: "read" },
  update_memory: { label: "Update Memory", kind: "edit" },
  validate: { label: "Validate Ledger", kind: "think" },
  commit_and_push: { label: "Commit & Push", kind: "execute" },
};

/** pi's built-in tools, which stay enabled alongside ours. */
const BUILTIN_TOOLS: Record<string, ToolPresentation> = {
  read: { label: "Read", kind: "read" },
  write: { label: "Write", kind: "edit" },
  edit: { label: "Edit", kind: "edit" },
  ls: { label: "List", kind: "read" },
  grep: { label: "Grep", kind: "search" },
  glob: { label: "Glob", kind: "search" },
  find: { label: "Find", kind: "search" },
  bash: { label: "Bash", kind: "execute" },
};

/** Title shown by the ACP client. Unknown tools fall back to a prettified name,
 *  matching the renderer's behavior, so a miss is cosmetic rather than broken. */
export function toolTitle(toolName: string): string {
  const known = EXTENSION_TOOLS[toolName] ?? BUILTIN_TOOLS[toolName];
  if (known) return known.label;
  return `${toolName.charAt(0).toUpperCase()}${toolName.slice(1)}`.replace(/[_-]+/g, " ");
}

/** ACP kind for the tool, defaulting to "other" for anything unrecognized. */
export function toolKind(toolName: string): ToolKind {
  return (EXTENSION_TOOLS[toolName] ?? BUILTIN_TOOLS[toolName])?.kind ?? "other";
}
