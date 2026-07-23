// @vitest-environment jsdom

// Integration: the Net Worth flow across real ChatLayout + real
// NetWorthView + the real rpc/api layer, over the fake `window.api`
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

// Heavy chat children with their own suites; the Net Worth view and the
// sidebar badge stay REAL.
vi.mock("../thread", () => ({ Thread: () => <div data-testid="thread" /> }));
vi.mock("../thread-list", () => ({
  ThreadList: () => <div data-testid="thread-list" />,
  ThreadListNew: () => <div data-testid="thread-list-new" />,
}));
vi.mock("../settings/settings", () => ({ Settings: () => null }));

import type { NetWorth } from "@/rpc/types";
import { ChatLayout } from "../chat-layout";

const DATA: NetWorth = {
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
  bridge.setHandler("ledger_net_worth", () => DATA);
});

afterEach(() => cleanup());

const openSheet = () => fireEvent.click(screen.getByRole("button", { name: "Net Worth" }));

describe("Net Worth view flow", () => {
  it("should show the compact net worth in the sidebar as soon as the layout loads", async () => {
    render(<ChatLayout />);
    // The badge's own fetch, before the page was ever opened.
    expect(await screen.findByText("2.7K EUR")).toBeInTheDocument();
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(1);
  });

  it("should fetch the report over IPC and render both sections when Net Worth is opened", async () => {
    render(<ChatLayout />);
    // One badge fetch on mount; the page adds its own on open.
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(1);

    openSheet();

    expect(await screen.findByTitle("assets:cash")).toBeInTheDocument();
    expect(screen.getByTitle("assets:checking")).toBeInTheDocument();
    expect(screen.getByText("~86.00 EUR")).toBeInTheDocument();
    expect(screen.getByTitle("liabilities:card")).toBeInTheDocument();
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(2);
  });

  it("should mark the sidebar entry active and keep the chat mounted but hidden while open", async () => {
    render(<ChatLayout />);
    openSheet();
    await screen.findByTitle("assets:cash");

    expect(screen.getByRole("button", { name: "Net Worth" })).toHaveAttribute("data-active");
    const thread = screen.getByTestId("thread");
    expect(thread).toBeInTheDocument();
    expect((thread.parentElement as HTMLElement).className).toContain("hidden");
  });

  it("should ignore a second click on the active entry: the page stays, with no extra IPC", async () => {
    render(<ChatLayout />);
    openSheet();
    await screen.findByTitle("assets:cash");

    openSheet();

    expect(screen.getByTitle("assets:cash")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Net Worth" })).toHaveAttribute("data-active");
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(2);
  });

  it("should fetch a fresh report on every open", async () => {
    render(<ChatLayout />);
    openSheet();
    await screen.findByTitle("assets:cash");
    // Returning to the chat goes through new chat (Cmd/Ctrl+N), not the entry.
    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    expect(screen.queryByTitle("assets:cash")).toBeNull();

    openSheet();
    await screen.findByTitle("assets:cash");
    expect(bridge.callsFor("ledger_net_worth")).toHaveLength(3);
  });

  it("should show the empty state when the report has no accounts", async () => {
    bridge.setHandler("ledger_net_worth", () => ({ sections: [], net: { amounts: [], value: [] } }));
    render(<ChatLayout />);
    openSheet();

    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
