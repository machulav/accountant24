import { UserMessageComponent } from "@mariozechner/pi-coding-agent";
import { Container, Spacer } from "@mariozechner/pi-tui";
import { LEDGER_DIR } from "../../config";
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

    // WORKAROUND: The framework skips the spacer before the first user message
    // (isFirstUserMessage flag in interactive-mode), leaving zero gap between
    // the header and the first message. Patch addChild to insert a spacer
    // before the first UserMessageComponent. Remove once fixed upstream.
    const chatContainer = tui.children?.[1] as Container | undefined;
    if (chatContainer) {
      const origAddChild = chatContainer.addChild.bind(chatContainer);
      chatContainer.addChild = (component: any) => {
        if (component instanceof UserMessageComponent) {
          origAddChild(new Spacer(1));
          chatContainer.addChild = origAddChild;
        }
        origAddChild(component);
      };
    }

    fetchBriefingData(`${LEDGER_DIR}/main.journal`).then((data) => {
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
