import { Container } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { buildLogoLine } from "./shared";

const PAD = "  ";

const b = {
  header: (t: string) => chalk.bold.green(t),
  emptyState: (t: string) => chalk.dim.italic(t),
};

export class Onboarding extends Container {
  render(width: number): string[] {
    return [
      "",
      b.header(buildLogoLine(width)),
      "",
      `${PAD}${b.emptyState("No transactions yet. Try something like:")}`,
      "",
      `${PAD}${PAD}${b.emptyState('"I spent 45 EUR on groceries at Whole Foods"')}`,
      `${PAD}${PAD}${b.emptyState('"I received 3000 EUR salary"')}`,
    ];
  }
}
