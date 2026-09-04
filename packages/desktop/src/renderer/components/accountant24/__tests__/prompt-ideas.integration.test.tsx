// @vitest-environment jsdom

// The prompt ideas flow across the renderer: the New Chat page asks main for
// the ledger's size over IPC, shows the matching set, and a click reports
// the idea's id over IPC while the text lands in the composer and nothing
// is sent. The preload bridge is the faked boundary; the thread, the
// composer, and the assistant-ui runtime run for real.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// rpc/api.ts captures `window.api` at module load — install the fake bridge
// before any import pulls it in (async vi.hoisted runs before the imports).
const bridge = await vi.hoisted(async () => (await import("@/test/fakeApi")).installFakeApi());

import {
  AssistantRuntimeProvider,
  type ExternalStoreAdapter,
  useAui,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { Thread } from "../thread";

beforeAll(() => {
  installJsdomPolyfills();
  // The thread viewport calls scrollTo on mount; jsdom omits it.
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  window.localStorage.clear();
  bridge.reset();
  bridge.setHandler("ledger_transaction_count", () => 0);
  // The composer's @-mentions, `/` skills, and model picker.
  bridge.setHandler("ledger_mentions", () => ({ accounts: [], payees: [], tags: [] }));
  bridge.setHandler("plugins_list", () => ({ plugins: [] }));
  bridge.setHandler("settings_get", () => ({ enabledModels: [] }));
  bridge.setHandler("analytics_track", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The aui handle of the rendered runtime, to read composer and thread state. */
let aui: ReturnType<typeof useAui> | undefined;
const CaptureAui = () => {
  aui = useAui();
  return null;
};

/** A real external-store runtime on the New Chat page: no messages, and the
 *  thread list still loading (the startup branch of isNewChatView). */
function Chrome({ children }: { children: ReactNode }) {
  const store = {
    messages: [],
    isRunning: false,
    onNew: async () => {},
    convertMessage: (m: unknown) => m,
    adapters: { threadList: { isLoading: true } },
  } as unknown as ExternalStoreAdapter;
  const runtime = useExternalStoreRuntime(store);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <CaptureAui />
      {children}
    </AssistantRuntimeProvider>
  );
}

const trackedEvents = () => bridge.callsFor("analytics_track");
const ideaNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole("button")
    .map((b) => b.textContent);

describe("prompt ideas on the New Chat page", () => {
  it("should ask main for the transaction count once and show the Getting started ideas for an empty ledger", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(
      <Chrome>
        <Thread />
      </Chrome>,
    );

    const list = await screen.findByRole("list", { name: "Prompt ideas" });
    expect(ideaNames(list)).toEqual([
      "Import my bank statement",
      "Record spending",
      "Add transactions from a receipt",
      "Set up my accounts",
      "Add a bank account",
    ]);
    expect(bridge.callsFor("ledger_transaction_count")).toEqual([undefined]);
  });

  it("should deal the next visit from the deck the previous visit left", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { unmount } = render(
      <Chrome>
        <Thread />
      </Chrome>,
    );
    await screen.findByRole("list", { name: "Prompt ideas" });
    unmount();

    render(
      <Chrome>
        <Thread />
      </Chrome>,
    );
    const list = await screen.findByRole("list", { name: "Prompt ideas" });
    expect(ideaNames(list)).toEqual([
      "Set my main currency",
      "What can you do?",
      "Remember my name",
      "Ask me a few questions to get to know me",
      "What should I do first?",
    ]);
  });

  it("should show one idea per other group once main reports more than 10 transactions", async () => {
    bridge.setHandler("ledger_transaction_count", () => 11);
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(
      <Chrome>
        <Thread />
      </Chrome>,
    );

    const list = await screen.findByRole("list", { name: "Prompt ideas" });
    expect(ideaNames(list)).toEqual([
      "Show my last transactions",
      "Record a refund",
      "Set a monthly budget and warn me when I get close",
      "What did you change today?",
      "What am I paying every month?",
    ]);
  });

  it("should put a clicked idea in the composer, focus it, report the id over IPC, and send nothing", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(
      <Chrome>
        <Thread />
      </Chrome>,
    );
    const list = await screen.findByRole("list", { name: "Prompt ideas" });

    await userEvent.click(within(list).getByRole("button", { name: "Record spending" }));

    expect(aui?.composer().getState().text).toBe("Record spending");
    await waitFor(() => expect(document.activeElement).toHaveClass("aui-lexical-input"));
    await waitFor(() =>
      expect(trackedEvents()).toEqual([{ event: "prompt_idea_used", props: { idea: "record-spending" } }]),
    );
    expect(aui?.thread().getState().messages).toHaveLength(0);
    expect(screen.getByRole("list", { name: "Prompt ideas" })).toBeInTheDocument();
  });
});
