import { buildArgs } from "../../core/tools/query.js";
import type { AppTheme } from "./theme.js";

export const SPINNER_FRAMES = ["$", "€", "£", "¥", "₴"];

export const TOOL_LABELS: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  validate: "Validate Workspace",
  query: "Query Ledger",
  add_transaction: "Add Transaction",
  update_memory: "Update Memory",
};

export function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function formatToolSummary(toolName: string, args: any): string {
  switch (toolName) {
    case "read":
      return args?.path ?? "";
    case "write":
      return args?.path ?? "";
    case "edit":
      return args?.path ?? "";
    case "bash":
      return truncate(args?.command ?? "", 60);
    case "validate":
      return "";
    case "query":
      return args?.report ? buildArgs(args, args?.file ?? "ledger/main.journal").join(" ") : "";
    case "add_transaction":
      return `${args?.date ?? ""} ${args?.payee ?? ""}`.trim();
    case "update_memory":
      return args?.facts?.length ? `${args.facts.length} fact(s)` : "";
    default:
      return "";
  }
}

export function renderToolLine(
  icon: string,
  label: string,
  summary: string,
  appTheme: AppTheme,
  isError?: boolean,
): string {
  let line = ` ${icon} ${appTheme.toolLabel(label)}`;
  if (summary) line += `  ${appTheme.toolArgs(summary)}`;
  if (isError) line += `  ${appTheme.toolError("(error)")}`;
  return line;
}
