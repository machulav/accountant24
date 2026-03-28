import chalk from "chalk";
import { formatDuration } from "./cli.js";
import type { EvalResult } from "./types.js";

export interface ReportOptions {
  evalModel?: string;
  evalProvider?: string;
  judgeModel?: string;
  judgeProvider?: string;
}

const W = 64;

export function formatResults(results: EvalResult[], options?: ReportOptions): string {
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

  return [
    ...formatHeader(),
    ...formatModels(options),
    ...formatSummary(passed.length, results.length, totalDuration),
    ...formatFailed(failed),
    ...formatPassed(passed),
    ...formatGrouped(
      "BY CATEGORY",
      groupBy(results, (r) => r.id.split("-").slice(0, 2).join("-")),
    ),
    ...formatGrouped(
      "BY SOURCE FILE",
      groupBy(results, (r) => r.sourceFile ?? "unknown"),
    ),
    "",
    chalk.bold("━".repeat(W)),
    "",
  ].join("\n");
}

// ── Section formatters ──────────────────────────────────────────────

function formatHeader(): string[] {
  const hrBold = chalk.bold("━".repeat(W));
  return ["", hrBold, chalk.bold(center("EVAL REPORT", W)), hrBold];
}

function formatModels(options?: ReportOptions): string[] {
  if (!options?.evalModel && !options?.judgeModel) return [];
  const lines: string[] = [""];
  if (options.evalModel) {
    lines.push(`  ${chalk.dim("Eval Model:")}   ${chalk.cyan(`${options.evalProvider ?? ""}/${options.evalModel}`)}`);
  }
  if (options.judgeModel) {
    lines.push(`  ${chalk.dim("Judge Model:")}  ${chalk.cyan(`${options.judgeProvider ?? ""}/${options.judgeModel}`)}`);
  }
  return lines;
}

function formatSummary(passedCount: number, totalCount: number, totalDuration: number): string[] {
  const hr = chalk.dim("─".repeat(W));
  const scorePercent = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;
  const scoreColor = scorePercent === 100 ? chalk.green : scorePercent > 0 ? chalk.yellow : chalk.red;
  const scoreText = scoreColor(`${passedCount}/${totalCount} passed (${scorePercent}%)`);
  return ["", hr, `  ${scoreText}    ${chalk.dim(formatDuration(totalDuration))}`, hr];
}

function formatFailed(failed: EvalResult[]): string[] {
  if (failed.length === 0) return [];
  const lines: string[] = ["", `  ${chalk.red.bold(`FAILED (${failed.length})`)}`, ""];
  for (const r of failed) {
    lines.push(`  ${chalk.red("✗")} ${r.id}`);
    lines.push(`    ${chalk.dim(formatDuration(r.durationMs))}`);
    if (r.error) {
      lines.push(`    ${chalk.red(`error: ${r.error}`)}`);
    }
    for (const c of r.checks.filter((c) => !c.passed)) {
      lines.push(`    ${chalk.dim(`[${c.check}]`)} ${c.detail}`);
    }
    lines.push("");
  }
  return lines;
}

function formatPassed(passed: EvalResult[]): string[] {
  if (passed.length === 0) return [];
  const lines: string[] = [`  ${chalk.green.bold(`PASSED (${passed.length})`)}`, ""];
  for (const r of passed) {
    lines.push(`  ${chalk.green("✓")} ${r.id}  ${chalk.dim(formatDuration(r.durationMs))}`);
  }
  lines.push("");
  return lines;
}

function formatGrouped(title: string, groups: Map<string, { passed: number; total: number }>): string[] {
  const hr = chalk.dim("─".repeat(W));
  const lines: string[] = [hr, `  ${chalk.bold(title)}`, hr, ""];
  const maxLen = Math.max(0, ...[...groups.keys()].map((k) => k.length));
  for (const [key, { passed, total }] of groups) {
    const icon = passed === total ? chalk.green("✓") : chalk.red("✗");
    const bar = renderBar(passed, total, 16);
    lines.push(`  ${icon} ${key.padEnd(maxLen)}  ${bar}  ${chalk.dim(`${passed}/${total}`)}`);
  }
  return lines;
}

// ── Helpers ──────────────────────────────────────────────────────────

function groupBy(
  results: EvalResult[],
  keyFn: (r: EvalResult) => string,
): Map<string, { passed: number; total: number }> {
  const map = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    const key = keyFn(r);
    const entry = map.get(key) ?? { passed: 0, total: 0 };
    entry.total++;
    if (r.passed) entry.passed++;
    map.set(key, entry);
  }
  return map;
}

function center(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return " ".repeat(pad) + text;
}

function renderBar(passed: number, total: number, width: number): string {
  const filled = total > 0 ? Math.round((passed / total) * width) : 0;
  return chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(width - filled));
}
