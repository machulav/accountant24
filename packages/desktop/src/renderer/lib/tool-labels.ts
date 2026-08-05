// Human-readable labels for the agent's tools, keyed by tool name (the event
// stream only carries tool names). An unknown name falls back to the raw tool
// name, so a miss is cosmetic, not broken.
export const TOOL_LABELS: Record<string, string> = {
  // Custom tools — deliberately DUPLICATED from
  // packages/pi-extension/src/tool-labels.ts so the renderer never imports from
  // the agent package. When a tool is added or renamed there, update this too.
  query: "Query Ledger",
  add_transactions: "Add Transactions",
  add_balance_assertions: "Add Balance Assertions",
  add_prices: "Add Prices",
  extract_text: "Extract Text",
  validate: "Validate Ledger",
  commit_and_push: "Commit & Push",

  // pi's built-in tools — pi only carries lowercase raw names for these, so
  // they are labeled here, renderer-side only.
  bash: "Run Command",
  read: "Read File",
  edit: "Edit File",
  write: "Write File",
  ls: "List Files",
  grep: "Search Files",
  find: "Find Files",
};
