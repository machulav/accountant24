// Human-readable labels for the agent's tools, keyed by tool name (the event
// stream only carries tool names).
//
// Deliberately DUPLICATED from packages/pi-extension/src/tool-labels.ts so the
// renderer never imports from the agent package. When a tool is added or
// renamed there, update this map too — an unknown name falls back to a
// prettified version of the raw tool name, so a miss is cosmetic, not broken.
export const TOOL_LABELS: Record<string, string> = {
  query: "Query Ledger",
  add_transactions: "Add Transactions",
  extract_text: "Extract Text",
  update_memory: "Update Memory",
  validate: "Validate Ledger",
  commit_and_push: "Commit & Push",
};
