import { Container, visibleWidth } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { LEDGER_DIR } from "../../config";
import { type BriefingData, fetchBriefingData } from "../../data";

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

const b = {
  header: (t: string) => chalk.bold.green(t),
  label: (t: string) => chalk.dim(t),
  amount: (t: string) => chalk.bold(t),
  changePositive: (t: string) => chalk.green(t),
  changeNegative: (t: string) => chalk.red(t),
  divider: (t: string) => chalk.dim(t),
  dim: (t: string) => chalk.dim(t),
  emptyState: (t: string) => chalk.dim.italic(t),
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  UAH: "₴",
  CHF: "CHF",
};

const PAD = "  ";
const LEFT_COL_RATIO = 0.35;

const NUM_FMT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function padEnd(str: string, targetVisible: number): string {
  const diff = targetVisible - visibleWidth(str);
  return diff > 0 ? `${str}${" ".repeat(diff)}` : str;
}

function padStart(str: string, targetVisible: number): string {
  const diff = targetVisible - visibleWidth(str);
  return diff > 0 ? `${" ".repeat(diff)}${str}` : str;
}

function formatMoney(amount: number, currency: string, forceSign: boolean): string {
  const formatted = NUM_FMT.format(Math.abs(amount));
  const sign = forceSign ? (amount >= 0 ? "+" : "-") : amount < 0 ? "-" : "";
  const symbol = CURRENCY_SYMBOLS[currency];
  if (symbol) return `${sign}${symbol}${formatted}`;
  if (currency) return `${sign}${formatted} ${currency}`;
  return `${sign}${formatted}`;
}

export function buildHeaderLine(label: string, width: number): string {
  const prefixLen = 2 + 1 + label.length + 1;
  const fillLen = Math.max(0, width - prefixLen);
  return `── ${label} ${"─".repeat(fillLen)}`;
}

export class Briefing extends Container {
  private data: BriefingData | null;

  constructor() {
    super();
    this.data = null;
  }

  setData(data: BriefingData): void {
    this.data = data;
  }

  render(width: number): string[] {
    if (!this.data) return [];

    if (this.data.error) {
      return ["", b.header(buildHeaderLine("Accountant24", width)), "", `${PAD}${b.emptyState(this.data.error)}`];
    }

    const contentWidth = width - PAD.length * 2;

    const hasData =
      this.data.netWorth || this.data.spendThisMonth || this.data.incomeThisMonth || this.data.topCategories.length > 0;

    if (!hasData) {
      return [
        "",
        b.header(buildHeaderLine("Accountant24", width)),
        "",
        `${PAD}${b.emptyState("No transactions yet. Start by telling me about your spending!")}`,
      ];
    }

    const lines: string[] = [];
    lines.push("", b.header(buildHeaderLine("Accountant24", width)));

    if (this.data.netWorth) {
      lines.push("", ...this.renderNetWorth());
    }

    const hasMonthly = this.data.spendThisMonth || this.data.incomeThisMonth || this.data.topCategories.length > 0;
    if (hasMonthly) {
      lines.push("", ...this.renderThisMonth(width, contentWidth));
    }

    return lines;
  }

  private renderNetWorth(): string[] {
    const nw = this.data?.netWorth;
    if (!nw) return [];
    let line = `${PAD}${b.label("Net Worth")}  ${b.amount(formatMoney(nw.amount, nw.currency, false))}`;
    if (nw.change !== 0) {
      const arrow = nw.change > 0 ? "▲" : "▼";
      const style = nw.change > 0 ? b.changePositive : b.changeNegative;
      line += `  ${style(`${arrow} ${formatMoney(Math.abs(nw.change), nw.currency, false)} this month`)}`;
    }
    return [line];
  }

  private renderSectionDivider(label: string, width: number): string[] {
    const prefix = `── ${label} `;
    const fillLen = Math.max(0, width - prefix.length);
    return [b.divider(`${prefix}${"─".repeat(fillLen)}`), ""];
  }

  private renderThisMonth(width: number, contentWidth: number): string[] {
    const lines: string[] = [];
    const sp = this.data?.spendThisMonth;
    const inc = this.data?.incomeThisMonth;
    const cats = this.data?.topCategories ?? [];
    const leftColWidth = Math.floor(contentWidth * LEFT_COL_RATIO);

    // Build divider: ── This Month ────── Top Categories ──────
    const hasLeft = sp || inc;
    const hasRight = cats.length > 0;
    let divider: string;
    if (hasLeft && hasRight) {
      const left = "── This Month ";
      const right = " Top Categories ";
      const fillLeft = Math.max(0, leftColWidth + PAD.length - left.length);
      const fillRight = Math.max(0, width - left.length - fillLeft - right.length);
      divider = `${left}${"─".repeat(fillLeft)}${right}${"─".repeat(fillRight)}`;
    } else if (hasLeft) {
      const left = "── This Month ";
      divider = `${left}${"─".repeat(Math.max(0, width - left.length))}`;
    } else {
      const left = "── Top Categories ";
      divider = `${left}${"─".repeat(Math.max(0, width - left.length))}`;
    }
    lines.push(b.divider(divider));
    lines.push("");

    // Build left column (Spent / Income)
    const leftLines: string[] = [];
    if (sp) leftLines.push(`${b.label("Spent")}   ${b.amount(formatMoney(sp.amount, sp.currency, false))}`);
    if (inc) leftLines.push(`${b.label("Income")}  ${b.amount(formatMoney(inc.amount, inc.currency, false))}`);

    // Build right column (categories)
    const rightLines: string[] = [];
    if (cats.length > 0) {
      const maxNameLen = Math.max(...cats.map((c) => c.name.length));
      const maxAmtLen = Math.max(...cats.map((c) => formatMoney(c.amount, c.currency, false).length));
      const totalCatAmount = cats.reduce((sum, c) => sum + c.amount, 0);

      for (const cat of cats) {
        const name = truncate(cat.name, maxNameLen);
        const amtStr = formatMoney(cat.amount, cat.currency, false);
        const pct = totalCatAmount > 0 ? Math.round((cat.amount / totalCatAmount) * 100) : 0;
        rightLines.push(`${padEnd(name, maxNameLen)}  ${b.amount(padStart(amtStr, maxAmtLen))}  ${b.dim(`${pct}%`)}`);
      }
    }

    // Merge columns side by side
    const rowCount = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < rowCount; i++) {
      const left = i < leftLines.length ? leftLines[i] : "";
      const right = i < rightLines.length ? rightLines[i] : "";
      lines.push(`${PAD}${padEnd(left, leftColWidth)}${right}`);
    }

    return lines;
  }
}

export function createBriefingFactory() {
  return (tui: any, _theme: any) => {
    const briefing = new Briefing();
    fetchBriefingData(`${LEDGER_DIR}/main.journal`).then((data) => {
      briefing.setData(data);
      tui.requestRender(true);
    });
    return briefing;
  };
}
