// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// Shared, mutable test state. `vi.hoisted` runs before the vi.mock factories
// (which are hoisted to the top of the module), so the mocks can close over it.
const h = vi.hoisted(() => ({
  // Fake pi runtime surface ChatLayout drives. MAIN is the viewed thread;
  // BG is a background thread.
  MAIN: "/ws/sessions/main.jsonl",
  BG: "/ws/sessions/background.jsonl",
  rename: vi.fn<(title: string) => Promise<void>>(),
  bgRename: vi.fn<(title: string) => Promise<void>>(),
  bgTitle: null as string | null,
  switchToNewThread: vi.fn(),
  thread: { title: null as string | null },
  // Per-session transcripts the fake client's getThread serves.
  transcripts: {} as Record<string, unknown[]>,
  getThread: vi.fn<(id: string) => Promise<{ messages: unknown[] }>>(),
  // Live agent-event subscribers (agentBridge.addEventListener registrations).
  agentListeners: new Set<(e: { type: string }) => void>(),
  // updateApi state the update banner reads.
  update: { pendingValue: null as string | null, downloadedCb: null as ((v: string) => void) | null },
  install: vi.fn(),
}));

// A single stable runtime object so ChatLayout's title effect subscribes once.
// getState reads `h` live, so tests can seed titles per case.
const fakeRuntime = {
  threads: {
    switchToNewThread: h.switchToNewThread,
    mainItem: { getState: () => ({ title: h.thread.title, isMain: true, id: h.MAIN }), rename: h.rename },
    getItemById: (id: string) => {
      if (id === h.MAIN)
        return { getState: () => ({ title: h.thread.title, isMain: true, id: h.MAIN }), rename: h.rename };
      if (id === h.BG) return { getState: () => ({ title: h.bgTitle, isMain: false, id: h.BG }), rename: h.bgRename };
      throw new Error("Thread not found");
    },
  },
};

// AssistantRuntimeProvider is a pure context wrapper here; the real one demands a
// full runtime we don't build. CompositeAttachmentAdapter is only constructed.
vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => children,
  CompositeAttachmentAdapter: class {},
}));

vi.mock("@assistant-ui/react-pi", () => ({
  usePiRuntime: () => fakeRuntime,
}));

// The client's only role here is serving transcripts for auto-titling.
vi.mock("@/runtime/electronPiClient", () => ({
  createElectronPiClient: () => ({ getThread: h.getThread }),
}));

vi.mock("@/runtime/fileAttachmentAdapter", () => ({
  ArchivingImageAttachmentAdapter: class {},
  WorkspaceFileAttachmentAdapter: class {},
}));

// The agent-event bus: capture subscribers so a test can push agent_start/end.
vi.mock("@/runtime/agentBridge", () => ({
  agentBridge: {
    addEventListener: (fn: (e: { type: string }) => void) => {
      h.agentListeners.add(fn);
      return () => h.agentListeners.delete(fn);
    },
  },
}));

// IPC boundary. Only updateApi is exercised (useUpdateStatus + UpdateBanner);
// the rest are defensive defaults per the repo's mocking convention.
vi.mock("@/rpc/api", () => ({
  updateApi: {
    pending: vi.fn(() => Promise.resolve(h.update.pendingValue)),
    install: h.install,
    onDownloaded: (cb: (v: string) => void) => {
      h.update.downloadedCb = cb;
      return () => {
        h.update.downloadedCb = null;
      };
    },
  },
  agentApi: { onEvent: vi.fn(), onTerminated: vi.fn(), onError: vi.fn(), send: vi.fn(), start: vi.fn() },
  authApi: {},
  settingsApi: {
    get: vi.fn().mockResolvedValue({ enabledModels: [], defaultModel: undefined }),
    onChange: () => () => {},
  },
  ledgerApi: {
    mentions: vi.fn().mockResolvedValue({ accounts: [], payees: [], tags: [] }),
    balances: vi.fn().mockResolvedValue([]),
  },
  skillsApi: { list: vi.fn().mockResolvedValue({ skills: [] }) },
  sessionsApi: { list: vi.fn().mockResolvedValue({ type: "ok", sessions: [] }) },
  appApi: { version: vi.fn().mockResolvedValue("1.0.0") },
}));

// Heavy children: ChatLayout only composes them, and each has its own test file.
// Stubbing keeps this suite focused on ChatLayout's own wiring. The thread-list
// stubs surface their selection callbacks as buttons so tests can fire them.
vi.mock("../thread", () => ({ Thread: () => <div data-testid="thread" /> }));
vi.mock("../thread-list", () => ({
  ThreadList: ({ onSelectThread, highlightActive }: { onSelectThread?: () => void; highlightActive?: boolean }) => (
    <div data-testid="thread-list" data-highlight-active={String(highlightActive)}>
      <button type="button" onClick={onSelectThread}>
        Select thread stub
      </button>
    </div>
  ),
  ThreadListNew: ({ onSelect }: { onSelect?: () => void }) => (
    <div data-testid="thread-list-new">
      <button type="button" onClick={onSelect}>
        New chat stub
      </button>
    </div>
  ),
}));
vi.mock("../net-worth-view", () => ({ NetWorthView: () => <div data-testid="net-worth-view" /> }));
// The Settings dialog is a real dialog elsewhere; here a light stub that mirrors
// the `open` prop, so we can assert ChatLayout opens/closes it.
vi.mock("../settings/settings", () => ({
  Settings: ({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) =>
    open ? (
      <div role="dialog" aria-label="Settings">
        <button type="button" onClick={() => onOpenChange(false)}>
          Close settings
        </button>
      </div>
    ) : null,
}));

import { ChatLayout } from "../chat-layout";

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
  h.rename.mockReset();
  h.rename.mockResolvedValue(undefined);
  h.bgRename.mockReset();
  h.bgRename.mockResolvedValue(undefined);
  h.bgTitle = null;
  h.switchToNewThread.mockReset();
  h.install.mockReset();
  h.thread.title = null;
  h.transcripts = {};
  h.getThread.mockReset();
  h.getThread.mockImplementation(async (id: string) => ({ messages: h.transcripts[id] ?? [] }));
  h.update.pendingValue = null;
  h.update.downloadedCb = null;
  h.agentListeners.clear();
});

afterEach(() => cleanup());

/** Push an agent event (tagged with its session) to every live subscriber,
 *  flushing React work. */
const emit = (type: string, sessionPath: string = h.MAIN) => {
  act(() => {
    for (const fn of [...h.agentListeners]) fn({ type, sessionPath } as never);
  });
};

/** Let the titling path's async transcript fetch settle. */
const flushTitling = () => act(async () => {});

const userMessage = (text: string) => ({ role: "user", content: [{ type: "text", text }] });

describe("ChatLayout composition", () => {
  it("should render the thread surface, sidebar list, and new-chat action without crashing", () => {
    render(<ChatLayout />);
    expect(screen.getByTestId("thread")).toBeInTheDocument();
    expect(screen.getByTestId("thread-list")).toBeInTheDocument();
    expect(screen.getByTestId("thread-list-new")).toBeInTheDocument();
  });

  it("should not show the Settings dialog before it is opened", () => {
    render(<ChatLayout />);
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });
});

describe("ChatLayout Settings dialog", () => {
  it("should open the Settings dialog when the footer Settings button is clicked", () => {
    render(<ChatLayout />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("should open the Settings dialog on the Cmd/Ctrl+, shortcut", () => {
    render(<ChatLayout />);
    fireEvent.keyDown(document.body, { key: ",", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("should close the Settings dialog when the dialog requests close", () => {
    render(<ChatLayout />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });
});

describe("ChatLayout Net Worth view", () => {
  const sheetButton = () => screen.getByRole("button", { name: "Net Worth" });
  /** The wrapper ChatLayout hides (display:none) while Accounts is open — the
   *  CSS contract for "the chat survives the switch" (jsdom applies no CSS). */
  const threadWrapper = () => screen.getByTestId("thread").parentElement as HTMLElement;

  it("should not show the Net Worth view initially", () => {
    render(<ChatLayout />);
    expect(screen.queryByTestId("net-worth-view")).toBeNull();
    expect(sheetButton()).not.toHaveAttribute("data-active");
  });

  it("should show the Net Worth view and keep the chat mounted but hidden when Net Worth is clicked", () => {
    render(<ChatLayout />);
    fireEvent.click(sheetButton());

    expect(screen.getByTestId("net-worth-view")).toBeInTheDocument();
    // The thread is still in the document (state preserved), only hidden.
    expect(screen.getByTestId("thread")).toBeInTheDocument();
    expect(threadWrapper().className).toContain("hidden");
    expect(sheetButton()).toHaveAttribute("data-active");
  });

  it("should mute the thread highlight while the Net Worth is open, and restore it back in the chat", () => {
    render(<ChatLayout />);
    expect(screen.getByTestId("thread-list")).toHaveAttribute("data-highlight-active", "true");

    fireEvent.click(sheetButton());
    expect(screen.getByTestId("thread-list")).toHaveAttribute("data-highlight-active", "false");

    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    expect(screen.getByTestId("thread-list")).toHaveAttribute("data-highlight-active", "true");
  });

  it("should keep the Net Worth open when the active entry is clicked again", () => {
    render(<ChatLayout />);
    fireEvent.click(sheetButton());
    fireEvent.click(sheetButton());

    expect(screen.getByTestId("net-worth-view")).toBeInTheDocument();
    expect(threadWrapper().className).toContain("hidden");
    expect(sheetButton()).toHaveAttribute("data-active");
  });

  it("should return to the chat when a thread is selected in the sidebar", () => {
    render(<ChatLayout />);
    fireEvent.click(sheetButton());
    fireEvent.click(screen.getByRole("button", { name: "Select thread stub" }));

    expect(screen.queryByTestId("net-worth-view")).toBeNull();
    expect(threadWrapper().className).not.toContain("hidden");
  });

  it("should return to the chat when a new chat is started from the sidebar", () => {
    render(<ChatLayout />);
    fireEvent.click(sheetButton());
    fireEvent.click(screen.getByRole("button", { name: "New chat stub" }));

    expect(screen.queryByTestId("net-worth-view")).toBeNull();
    expect(threadWrapper().className).not.toContain("hidden");
  });

  it("should return to the chat on the Cmd/Ctrl+N shortcut", () => {
    render(<ChatLayout />);
    fireEvent.click(sheetButton());
    fireEvent.keyDown(document.body, { key: "n", metaKey: true });

    expect(screen.queryByTestId("net-worth-view")).toBeNull();
    expect(threadWrapper().className).not.toContain("hidden");
    expect(h.switchToNewThread).toHaveBeenCalledTimes(1);
  });
});

describe("ChatLayout keyboard shortcuts", () => {
  it("should start a new thread on the Cmd/Ctrl+N shortcut", () => {
    render(<ChatLayout />);
    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    expect(h.switchToNewThread).toHaveBeenCalledTimes(1);
  });

  it("should not start a new thread when a bare key is pressed without the modifier", () => {
    render(<ChatLayout />);
    fireEvent.keyDown(document.body, { key: "n" });
    expect(h.switchToNewThread).not.toHaveBeenCalled();
  });
});

describe("ChatLayout update banner", () => {
  it("should not show the relaunch banner when no update is pending", async () => {
    h.update.pendingValue = null;
    render(<ChatLayout />);
    // Let the pending() promise settle; it resolves null so nothing appears.
    await Promise.resolve();
    expect(screen.queryByText("Relaunch to update")).toBeNull();
  });

  it("should show the relaunch banner with the pending version when an update is staged", async () => {
    h.update.pendingValue = "2.3.0";
    render(<ChatLayout />);
    expect(await screen.findByText("Relaunch to update")).toBeInTheDocument();
    expect(screen.getByText("v2.3.0")).toBeInTheDocument();
  });

  it("should show the relaunch banner when an update-downloaded push arrives after mount", async () => {
    h.update.pendingValue = null;
    render(<ChatLayout />);
    await waitFor(() => expect(h.update.downloadedCb).not.toBeNull());
    expect(screen.queryByText("Relaunch to update")).toBeNull();

    act(() => h.update.downloadedCb?.("3.1.0"));

    expect(await screen.findByText("Relaunch to update")).toBeInTheDocument();
    expect(screen.getByText("v3.1.0")).toBeInTheDocument();
  });
});

describe("ChatLayout auto-titling of new chats", () => {
  it("should title an untitled chat from the transcript's first user message when a run ends", async () => {
    h.thread.title = null;
    h.transcripts[h.MAIN] = [userMessage("what is my balance")];
    render(<ChatLayout />);

    emit("agent_start");
    emit("agent_end");
    await flushTitling();

    expect(h.rename).toHaveBeenCalledTimes(1);
    expect(h.rename).toHaveBeenCalledWith("what is my balance");
  });

  it("should truncate a long first message to 60 characters with an ellipsis", async () => {
    // Spec: deriveChatTitle caps titles at 60 chars + "…".
    const long = "a".repeat(61);
    const expected = `${"a".repeat(60)}…`;
    h.thread.title = null;
    h.transcripts[h.MAIN] = [userMessage(long)];
    render(<ChatLayout />);

    emit("agent_start");
    emit("agent_end");
    await flushTitling();

    expect(h.rename).toHaveBeenCalledWith(expected);
  });

  it("should not retitle (nor fetch the transcript of) a chat that already has a title", async () => {
    h.thread.title = "Groceries budget";
    h.transcripts[h.MAIN] = [userMessage("what is my balance")];
    render(<ChatLayout />);

    emit("agent_start");
    emit("agent_end");
    await flushTitling();

    expect(h.rename).not.toHaveBeenCalled();
    expect(h.getThread).not.toHaveBeenCalled();
  });

  it("should not rename when there is nothing to title from (no user message)", async () => {
    h.thread.title = null;
    h.transcripts[h.MAIN] = [];
    render(<ChatLayout />);

    emit("agent_start");
    emit("agent_end");
    await flushTitling();

    expect(h.rename).not.toHaveBeenCalled();
  });

  it("should not rename on a bare agent_start with no run completion", async () => {
    h.thread.title = null;
    h.transcripts[h.MAIN] = [userMessage("what is my balance")];
    render(<ChatLayout />);

    emit("agent_start");
    await flushTitling();

    expect(h.rename).not.toHaveBeenCalled();
  });

  it("should not rename when the chat was titled while the transcript fetch was in flight", async () => {
    h.thread.title = null;
    h.transcripts[h.MAIN] = [userMessage("what is my balance")];
    let release: (value: { messages: unknown[] }) => void = () => {};
    h.getThread.mockImplementationOnce(() => new Promise((r) => (release = r)));
    render(<ChatLayout />);

    emit("agent_start");
    emit("agent_end");
    h.thread.title = "Renamed by hand"; // lands before the fetch resolves
    release({ messages: h.transcripts[h.MAIN] });
    await flushTitling();

    expect(h.rename).not.toHaveBeenCalled();
  });
});

describe("ChatLayout auto-titling of background chats", () => {
  it("should title the background chat (not the viewed one) when its run ends", async () => {
    // The viewed thread has its own untitled state — a background completion
    // must not touch it.
    h.thread.title = null;
    h.transcripts[h.MAIN] = [userMessage("main thread question")];
    h.transcripts[h.BG] = [userMessage("categorize last month")];
    render(<ChatLayout />);

    emit("agent_start", h.BG);
    emit("agent_end", h.BG);
    await flushTitling();

    expect(h.bgRename).toHaveBeenCalledTimes(1);
    expect(h.bgRename).toHaveBeenCalledWith("categorize last month");
    expect(h.rename).not.toHaveBeenCalled();
  });

  it("should title from the transcript's FIRST user message, not a later one", async () => {
    h.transcripts[h.BG] = [
      userMessage("first question"),
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
      userMessage("second question"),
    ];
    render(<ChatLayout />);

    emit("agent_start", h.BG);
    emit("agent_end", h.BG);
    await flushTitling();

    expect(h.bgRename).toHaveBeenCalledWith("first question");
  });

  it("should not retitle a background chat that already has a title", async () => {
    h.bgTitle = "Named already";
    h.transcripts[h.BG] = [userMessage("categorize last month")];
    render(<ChatLayout />);

    emit("agent_start", h.BG);
    emit("agent_end", h.BG);
    await flushTitling();

    expect(h.bgRename).not.toHaveBeenCalled();
    expect(h.getThread).not.toHaveBeenCalled();
  });

  it("should not crash when a run ends for a session unknown to the thread list", async () => {
    render(<ChatLayout />);

    emit("agent_start", "/ws/sessions/unknown.jsonl");
    emit("agent_end", "/ws/sessions/unknown.jsonl");
    await flushTitling();

    expect(h.rename).not.toHaveBeenCalled();
    expect(h.bgRename).not.toHaveBeenCalled();
    expect(h.getThread).not.toHaveBeenCalled();
  });

  it("should not rename when the transcript fetch fails", async () => {
    h.getThread.mockRejectedValueOnce(new Error("child crashed"));
    render(<ChatLayout />);

    emit("agent_start", h.BG);
    emit("agent_end", h.BG);
    await flushTitling();

    expect(h.bgRename).not.toHaveBeenCalled();
  });
});
