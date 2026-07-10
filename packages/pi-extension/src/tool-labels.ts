// Human-readable labels for this extension's tools, keyed by tool name.
//
// Single source of truth for both sides of the RPC boundary: the tool
// definitions here use it for `label`, and the desktop renderer imports it
// via "@accountant24/pi-extension/tool-labels" (the RPC stream only carries
// tool names). Keep this module dependency-free — it is bundled into the
// renderer.
export const TOOL_LABELS: Record<string, string> = {
  query: "Query Ledger",
  add_transactions: "Add Transactions",
  extract_text: "Extract Text",
  update_memory: "Update Memory",
  validate: "Validate Ledger",
  commit_and_push: "Commit & Push",
};
