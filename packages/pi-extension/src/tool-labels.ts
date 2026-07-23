// Human-readable labels for this extension's tools, keyed by tool name; the
// tool definitions use it for `label`. The desktop renderer keeps its own
// deliberate copy (packages/desktop/src/renderer/lib/tool-labels.ts) — when a
// tool is added or renamed here, update that map too.
export const TOOL_LABELS: Record<string, string> = {
  query: "Query Ledger",
  add_transactions: "Add Transactions",
  add_balance_assertions: "Add Balance Assertions",
  add_prices: "Add Prices",
  extract_text: "Extract Text",
  update_memory: "Update Memory",
  validate: "Validate Ledger",
  commit_and_push: "Commit & Push",
};
