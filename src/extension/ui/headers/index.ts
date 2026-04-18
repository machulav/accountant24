import { Container } from "@mariozechner/pi-tui";
import { MAIN_LEDGER_FILE } from "../../config";
import { type BriefingData, fetchBriefingData } from "../../ledger";
import { Briefing } from "./briefing";
import { Onboarding } from "./onboarding";

function hasTransactions(data: BriefingData): boolean {
  return (
    data.netWorth.length > 0 ||
    data.spendThisMonth.length > 0 ||
    data.incomeThisMonth.length > 0 ||
    data.topCategories.length > 0
  );
}

class HeaderSwitch extends Container {
  private active: Container | null = null;

  setActive(component: Container): void {
    this.active = component;
  }

  render(width: number): string[] {
    return this.active ? this.active.render(width) : [];
  }
}

export function createHeaderFactory() {
  return (tui: any, _theme: any) => {
    const header = new HeaderSwitch();

    fetchBriefingData(MAIN_LEDGER_FILE).then((data) => {
      if (data.error || hasTransactions(data)) {
        const briefing = new Briefing();
        briefing.setData(data);
        header.setActive(briefing);
      } else {
        header.setActive(new Onboarding());
      }
      tui.requestRender(true);
    });

    return header;
  };
}
