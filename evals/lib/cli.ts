import chalk from "chalk";
import { formatResults } from "./reporter";
import type { EvalRunConfig, ProgressEvent } from "./runner";
import { runEval } from "./runner";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export interface TableRow {
  index: number;
  total: number;
  id: string;
  status: "running" | "pass" | "fail";
  durationMs?: number;
}

export function formatTableRow(row: TableRow, maxIdLen: number): string {
  const num = `[${row.index + 1}/${row.total}]`.padEnd(8);
  const id = row.id.padEnd(maxIdLen);
  if (row.status === "running") {
    return `  ${num} ${id}  ${chalk.yellow("...")}`;
  }
  const icon = row.status === "pass" ? chalk.green("PASS") : chalk.red("FAIL");
  const dur = row.durationMs !== undefined ? chalk.dim(formatDuration(row.durationMs)) : "";
  return `  ${num} ${id}  ${icon} ${dur}`;
}

export function renderTable(rows: TableRow[], total: number, modelLabel?: string): string {
  const label = modelLabel ? ` with ${chalk.cyan(modelLabel)}` : "";
  const header = `\n  Running ${total} eval(s)${label}\n`;
  const maxIdLen = Math.max(0, ...rows.map((r) => r.id.length));
  const lines = rows.map((r) => formatTableRow(r, maxIdLen));
  return header + lines.join("\n");
}

export function createProgressHandler(modelLabel?: string): (event: ProgressEvent) => void {
  const rows: TableRow[] = [];
  let prevLineCount = 0;

  return (event: ProgressEvent) => {
    switch (event.type) {
      case "start":
        rows.length = 0;
        prevLineCount = 0;
        break;
      case "case_start":
        rows.push({ index: event.index, total: event.total, id: event.id, status: "running" });
        break;
      case "case_end": {
        const row = rows.find((r) => r.id === event.id && r.index === event.index);
        if (row) {
          row.status = event.passed ? "pass" : "fail";
          row.durationMs = event.durationMs;
        }
        break;
      }
    }

    if (event.type === "start") return;

    const output = renderTable(rows, event.total, modelLabel);
    const lines = output.split("\n");

    if (prevLineCount > 0) {
      process.stdout.write(`\x1b[${prevLineCount}A\x1b[0J`);
    }

    process.stdout.write(`${output}\n`);
    prevLineCount = lines.length;
  };
}

export interface CliConfig {
  provider: string;
  model: string;
  judgeProvider: string;
  judgeModel: string;
  filter?: string;
}

export async function main(config: CliConfig): Promise<{ exitCode: number }> {
  const modelLabel = `${config.provider}/${config.model}`;
  const onProgress = createProgressHandler(modelLabel);
  const runConfig: EvalRunConfig = { ...config, onProgress };
  const results = await runEval(runConfig);

  if (results.length > 0) {
    console.log(
      formatResults(results, {
        evalModel: config.model,
        evalProvider: config.provider,
        judgeModel: config.judgeModel,
        judgeProvider: config.judgeProvider,
      }),
    );
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.error(`\n${failed.length} eval(s) failed.`);
    return { exitCode: 1 };
  }

  return { exitCode: 0 };
}
