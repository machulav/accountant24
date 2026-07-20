import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCOUNTANT24_HOME } from "../config";
import { runHledger } from "./hledger";
import { resolveSafePath } from "./paths";

const PERIOD_FLAGS: Record<string, string> = {
  daily: "--daily",
  weekly: "--weekly",
  monthly: "--monthly",
  quarterly: "--quarterly",
  yearly: "--yearly",
};

// TUI box border (2) + padding (2) + content indent (2)
const TUI_CHROME_WIDTH = 6;

// Reports past this size are rarely worth reading inline (a large `reg` dump
// meant for further processing, not for the model to read directly) and cost
// real context tokens - spill them to a scratch file instead. node:os tmpdir(),
// not the workspace: `files/` is the user's git-tracked ledger workspace, and
// a scratch dump left there would eventually get swept into a commit.
const MAX_INLINE_LINES = 200;

const OUTPUT_EXTENSIONS: Record<string, string> = { csv: "csv", tsv: "tsv", json: "json" };

export interface QueryLedgerResult {
  command: string;
  output: string;
  outputFile?: string;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines.length;
}

export async function queryLedger(params: any, signal?: AbortSignal): Promise<QueryLedgerResult> {
  const file = params.file ?? "ledger/main.journal";
  const resolved = resolveSafePath(file, ACCOUNTANT24_HOME);
  const args = buildQueryArgs(params, resolved);
  const raw = await runHledger(args, { signal });
  const command = ["hledger", ...args].join(" ");

  const lineCount = countLines(raw);
  if (lineCount > MAX_INLINE_LINES) {
    const dir = mkdtempSync(join(tmpdir(), "accountant24-query-output-"));
    const ext = OUTPUT_EXTENSIONS[params.output_format] ?? "txt";
    const outputFile = join(dir, `output.${ext}`);
    writeFileSync(outputFile, raw);
    return {
      command,
      output: `Output has ${lineCount} lines (over the ${MAX_INLINE_LINES}-line inline limit) - written to ${outputFile} instead of returning it inline. Read it from there (e.g. with bash or a script) rather than re-running this query.`,
      outputFile,
    };
  }

  return { command, output: raw || "(no results)" };
}

function buildQueryArgs(params: any, resolved: string): string[] {
  const args = [params.report, "-f", resolved];

  if (params.account_pattern) args.push(params.account_pattern);
  if (params.description_pattern) args.push(`desc:${params.description_pattern}`);
  if (params.payee_pattern) args.push(`payee:${params.payee_pattern}`);
  if (params.amount_filter) args.push(`amt:${params.amount_filter}`);
  if (params.tag) args.push(`tag:${params.tag}`);
  if (params.status === "cleared") args.push("status:*");
  else if (params.status === "pending") args.push("status:!");
  else if (params.status === "unmarked") args.push("status:");

  if (params.begin_date) args.push("-b", params.begin_date);
  if (params.end_date) args.push("-e", params.end_date);
  else args.push("-e", "tomorrow");

  if (params.period && PERIOD_FLAGS[params.period]) {
    args.push(PERIOD_FLAGS[params.period]);
  }

  if (params.depth != null) args.push("--depth", String(params.depth));
  if (params.invert) args.push("--invert");
  if (params.output_format) args.push("-O", params.output_format);

  if (params.report === "reg" || params.report === "aregister") {
    const width = (process.stdout.columns || 80) - TUI_CHROME_WIDTH;
    args.push(`--width=${width}`);
  }

  return args;
}
