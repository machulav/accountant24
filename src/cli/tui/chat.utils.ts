import type { AppTheme } from "./theme.js";
import { buildArgs } from "../../core/tools/query.js";

export const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];

export const TOOL_LABELS: Record<string, string> = {
  read_file: "Read File",
  write_file: "Write File",
  execute: "Execute",
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
    case "read_file":
      return args?.path ?? "";
    case "write_file":
      return args?.path ?? "";
    case "execute":
      return truncate(args?.command ?? "", 60);
    case "validate":
      return "";
    case "query":
      return args?.report
        ? buildArgs(args, args?.file ?? "ledger/main.journal").join(" ")
        : "";
    case "add_transaction":
      return `${args?.date ?? ""} ${args?.payee ?? ""}`.trim();
    case "update_memory":
      return args?.section ?? "";
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
