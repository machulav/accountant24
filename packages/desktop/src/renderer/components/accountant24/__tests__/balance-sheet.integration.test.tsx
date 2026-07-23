// @vitest-environment jsdom

// Integration: the Balance Sheet flow across real ChatLayout + real
// BalanceSheetView + the real rpc/api layer, over the fake `window.api`
// bridge. Asserts both the UI and the exact IPC traffic. The pi runtime and
// heavy chat children are stubbed (they have their own suites); the IPC
// boundary is the fake bridge.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// rpc/api.ts captures `window.api` at module load — install the fake bridge
// before any import pulls it in (async vi.hoisted runs before the imports).
const bridge = await vi.hoisted(async () => (await import("@/test/fakeApi")).installFakeApi());

// The pi runtime surface ChatLayout drives; only what this flow touches.
vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => children,
  CompositeAttachmentAdapter: class {},
  useAuiState: (sel: (s: unknown) => unknown) => sel({ thread: { isRunning: false } }),
}));
vi.mock("@assistant-ui/react-pi", () => ({
  usePiRuntime: () => ({ threads: { switchToNewThread: vi.fn() } }),
}));
vi.mock("@/runtime/electronPiClient", () => ({
  createElectronPiClient: () => ({ getThread: vi.fn() }),
}));
vi.mock("@/runtime/fileAttachmentAdapter", () => ({
  ArchivingImageAttachmentAdapter: class {},
  WorkspaceFileAttachmentAdapter: class {},
}));
vi.mock("@/runtime/agentBridge", () => ({
  agentBridge: { addEventListener: () => () => {} },
}));

// Heavy chat children with their own suites; the Balance Sheet view stays REAL.
vi.mock("../thread", () => ({ Thread: () => <div data-testid="thread" /> }));
vi.mock("../thread-list", () => ({
  ThreadList: () => <div data-testid="thread-list" />,
  ThreadListNew: () => <div data-testid="thread-list-new" />,
}));
vi.mock("../settings/settings", () => ({ Settings: () => null }));

import type { BalanceSheet } from "@/rpc/types";
import { ChatLayout } from "../chat-layout";

const DATA: BalanceSheet = {
  sections: [
    {
      name: "Assets",
      rows: [
        {
          name: "assets:cash",
          amounts: [{ quantity: 100, commodity: "USD", precision: 2 }],
          value: [{ quantity: 86, commodity: "EUR", precision: 2 }],
          assertedOn: "2026-07-01",
        },
        {
          name: "assets:checking",
          amounts: [{ quantity: 2950, commodity: "EUR", precision: 2 }],
          value: [{ quantity: 2950, commodity: "EUR", precision: 2 }],
        },
      ],
      total: {
        amounts: [{ quantity: 3036, commodity: "EUR", precision: 2 }],
        value: [{ quantity: 3036, commodity: "EUR", precision: 2 }],
      },
    },
    {
      name: "Liabilities",
      rows: [
        {
          name: "liabilities:card",
          amounts: [{ quantity: 300, commodity: "EUR", precision: 2 }],
          value: [{ quantity: 300, commodity: "EUR", precision: 2 }],
        },
      ],
      total: {
        amounts: [{ quantity: 300, commodity: "EUR", precision: 2 }],
        value: [{ quantity: 300, commodity: "EUR", precision: 2 }],
      },
    },
  ],
  net: {
    amounts: [{ quantity: 2736, commodity: "EUR", precision: 2 }],
    value: [{ quantity: 2736, commodity: "EUR", precision: 2 }],
  },
};

beforeAll(() => {
  installJsdomPolyfills();
  // The sidebar seeds its width from localStorage, which this jsdom env omits.
  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  }
});

beforeEach(() => {
  bridge.reset();
  bridge.setHandler("update_pending", () => null);
  bridge.setHandler("ledger_balance_sheet", () => DATA);
});

afterEach(() => cleanup());

const openSheet = () => fireEvent.click(screen.getByRole("button", { name: "Balance Sheet" }));

describe("Balance Sheet view flow", () => {
  it("should fetch the report over IPC exactly once and render both sections when Balance Sheet is opened", async () => {
    render(<ChatLayout />);
    expect(bridge.callsFor("ledger_balance_sheet")).toHaveLength(0);

    openSheet();

    expect(await screen.findByTitle("assets:cash")).toBeInTheDocument();
    expect(screen.getByTitle("assets:checking")).toBeInTheDocument();
    expect(screen.getByText("~86.00 EUR")).toBeInTheDocument();
    expect(screen.getByTitle("liabilities:card")).toBeInTheDocument();
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
    expect(bridge.callsFor("ledger_balance_sheet")).toHaveLength(1);
  });

  it("should mark the sidebar entry active and keep the chat mounted but hidden while open", async () => {
    render(<ChatLayout />);
    openSheet();
    await screen.findByTitle("assets:cash");

    expect(screen.getByRole("button", { name: "Balance Sheet" })).toHaveAttribute("data-active");
    const thread = screen.getByTestId("thread");
    expect(thread).toBeInTheDocument();
    expect((thread.parentElement as HTMLElement).className).toContain("hidden");
  });

  it("should return to the chat, without extra IPC, when Balance Sheet is toggled closed", async () => {
    render(<ChatLayout />);
    openSheet();
    await screen.findByTitle("assets:cash");

    openSheet();

    expect(screen.queryByTitle("assets:cash")).toBeNull();
    expect((screen.getByTestId("thread").parentElement as HTMLElement).className).not.toContain("hidden");
    expect(screen.getByRole("button", { name: "Balance Sheet" })).not.toHaveAttribute("data-active");
    expect(bridge.callsFor("ledger_balance_sheet")).toHaveLength(1);
  });

  it("should fetch a fresh report on every open", async () => {
    render(<ChatLayout />);
    openSheet();
    await screen.findByTitle("assets:cash");
    openSheet();

    openSheet();
    await screen.findByTitle("assets:cash");
    expect(bridge.callsFor("ledger_balance_sheet")).toHaveLength(2);
  });

  it("should show the empty state when the report has no accounts", async () => {
    bridge.setHandler("ledger_balance_sheet", () => ({ sections: [], net: { amounts: [], value: [] } }));
    render(<ChatLayout />);
    openSheet();

    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
