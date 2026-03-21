import chalk from "chalk";
import type { EvalResult } from "./types.js";

export interface ReportOptions {
  evalModel?: string;
  evalProvider?: string;
  judgeModel?: string;
  judgeProvider?: string;
}

export function formatResults(results: EvalResult[], options?: ReportOptions): string {
  const W = 64;
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const lines: string[] = [];

  const hr = chalk.dim("─".repeat(W));
  const hrBold = chalk.bold("━".repeat(W));

  // ── Header ──────────────────────────────────────────────────────────

  lines.push("");
  lines.push(hrBold);
  lines.push(chalk.bold(center("EVAL REPORT", W)));
  lines.push(hrBold);

  // ── Models ──────────────────────────────────────────────────────────

  if (options?.evalModel || options?.judgeModel) {
    lines.push("");
    if (options.evalModel) {
      lines.push(`  ${chalk.dim("Eval Model:")}   ${chalk.cyan(`${options.evalProvider ?? ""}/${options.evalModel}`)}`);
    }
    if (options.judgeModel) {
      lines.push(
        `  ${chalk.dim("Judge Model:")}  ${chalk.cyan(`${options.judgeProvider ?? ""}/${options.judgeModel}`)}`,
      );
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────

  lines.push("");
  lines.push(hr);
  const scorePercent = results.length > 0 ? Math.round((passed.length / results.length) * 100) : 0;
  const scoreColor = scorePercent === 100 ? chalk.green : scorePercent > 0 ? chalk.yellow : chalk.red;
  const scoreText = scoreColor(`${passed.length}/${results.length} passed (${scorePercent}%)`);
  lines.push(`  ${scoreText}    ${chalk.dim(formatDuration(totalDuration))}`);
  lines.push(hr);

  // ── Failed ──────────────────────────────────────────────────────────

  if (failed.length > 0) {
    lines.push("");
    lines.push(`  ${chalk.red.bold(`FAILED (${failed.length})`)}`);
    lines.push("");

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
  }

  // ── Passed ──────────────────────────────────────────────────────────

  if (passed.length > 0) {
    lines.push(`  ${chalk.green.bold(`PASSED (${passed.length})`)}`);
    lines.push("");

    for (const r of passed) {
      lines.push(`  ${chalk.green("✓")} ${r.id}  ${chalk.dim(formatDuration(r.durationMs))}`);
    }
    lines.push("");
  }

  // ── By category ─────────────────────────────────────────────────────

  const byCategory = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    const cat = r.id.split("-").slice(0, 2).join("-");
    const entry = byCategory.get(cat) ?? { passed: 0, total: 0 };
    entry.total++;
    if (r.passed) entry.passed++;
    byCategory.set(cat, entry);
  }

  lines.push(hr);
  lines.push(`  ${chalk.bold("BY CATEGORY")}`);
  lines.push(hr);
  lines.push("");

  const maxCatLen = Math.max(0, ...[...byCategory.keys()].map((k) => k.length));

  for (const [cat, { passed: p, total }] of byCategory) {
    const icon = p === total ? chalk.green("✓") : chalk.red("✗");
    const bar = renderBar(p, total, 16);
    lines.push(`  ${icon} ${cat.padEnd(maxCatLen)}  ${bar}  ${chalk.dim(`${p}/${total}`)}`);
  }

  // ── By source file ──────────────────────────────────────────────────

  const byFile = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    const file = r.sourceFile ?? "unknown";
    const entry = byFile.get(file) ?? { passed: 0, total: 0 };
    entry.total++;
    if (r.passed) entry.passed++;
    byFile.set(file, entry);
  }

  lines.push("");
  lines.push(hr);
  lines.push(`  ${chalk.bold("BY SOURCE FILE")}`);
  lines.push(hr);
  lines.push("");

  const maxFileLen = Math.max(0, ...[...byFile.keys()].map((k) => k.length));

  for (const [file, { passed: p, total }] of byFile) {
    const icon = p === total ? chalk.green("✓") : chalk.red("✗");
    const bar = renderBar(p, total, 16);
    lines.push(`  ${icon} ${file.padEnd(maxFileLen)}  ${bar}  ${chalk.dim(`${p}/${total}`)}`);
  }

  lines.push("");
  lines.push(hrBold);
  lines.push("");

  return lines.join("\n");
}

function center(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return " ".repeat(pad) + text;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderBar(passed: number, total: number, width: number): string {
  const filled = total > 0 ? Math.round((passed / total) * width) : 0;
  return chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(width - filled));
}
