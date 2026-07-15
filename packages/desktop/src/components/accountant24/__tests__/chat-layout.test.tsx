// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// Shared, mutable test state. `vi.hoisted` runs before the vi.mock factories
// (which are hoisted to the top of the module), so the mocks can close over it.
const h = vi.hoisted(() => ({
  // Fake pi runtime surface ChatLayout drives.
  rename: vi.fn<(title: string) => Promise<void>>(),
  switchToNewThread: vi.fn(),
  thread: { title: null as string | null, messages: [] as { role: string; content: unknown[] }[] },
  // Live agent-event subscribers (agentBridge.addEventListener registrations).
  agentListeners: new Set<(e: { type: string }) => void>(),
  // updateApi state the update banner reads.
  update: { pendingValue: null as string | null, downloadedCb: null as ((v: string) => void) | null },
  install: vi.fn(),
}));

// A single stable runtime object so ChatLayout's title effect subscribes once.
// getState reads `h.thread` live, so tests can seed messages/title per case.
const fakeRuntime = {
  threads: {
    switchToNewThread: h.switchToNewThread,
    mainItem: { getState: () => ({ title: h.thread.title }), rename: h.rename },
  },
  thread: { getState: () => ({ messages: h.thread.messages }) },
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

vi.mock("@/runtime/electronPiClient", () => ({
  createElectronPiClient: () => ({ __client: true }),
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
  ledgerApi: { mentions: vi.fn().mockResolvedValue({ accounts: [], payees: [], tags: [] }) },
  skillsApi: { list: vi.fn().mockResolvedValue({ skills: [] }) },
  sessionsApi: { list: vi.fn().mockResolvedValue({ type: "ok", sessions: [] }) },
  appApi: { version: vi.fn().mockResolvedValue("1.0.0") },
}));

// Heavy children: ChatLayout only composes them, and each has its own test file.
// Stubbing keeps this suite focused on ChatLayout's own wiring.
vi.mock("../thread", () => ({ Thread: () => <div data-testid="thread" /> }));
vi.mock("../thread-list", () => ({
  ThreadList: () => <div data-testid="thread-list" />,
  ThreadListNew: () => <div data-testid="thread-list-new" />,
}));
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
  h.switchToNewThread.mockReset();
  h.install.mockReset();
  h.thread.title = null;
  h.thread.messages = [];
  h.update.pendingValue = null;
  h.update.downloadedCb = null;
  h.agentListeners.clear();
});

afterEach(() => cleanup());

/** Push an agent event to every live subscriber, flushing React work. */
const emit = (type: string) => {
  act(() => {
    for (const fn of [...h.agentListeners]) fn({ type });
  });
};

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
  it("should title an untitled chat from the first user message when a run ends", () => {
    h.thread.title = null;
    h.thread.messages = [userMessage("what is my balance")];
    render(<ChatLayout />);

    emit("agent_start");
    emit("agent_end");

    expect(h.rename).toHaveBeenCalledTimes(1);
    expect(h.rename).toHaveBeenCalledWith("what is my balance");
  });

  it("should truncate a long first message to 60 characters with an ellipsis", () => {
    // Spec: deriveChatTitle caps titles at 60 chars + "…".
    const long = "a".repeat(61);
    const expected = `${"a".repeat(60)}…`;
    h.thread.title = null;
    h.thread.messages = [userMessage(long)];
    render(<ChatLayout />);

    emit("agent_start");
    emit("agent_end");

    expect(h.rename).toHaveBeenCalledWith(expected);
  });

  it("should not retitle a chat that already has a title", () => {
    h.thread.title = "Groceries budget";
    h.thread.messages = [userMessage("what is my balance")];
    render(<ChatLayout />);

    emit("agent_start");
    emit("agent_end");

    expect(h.rename).not.toHaveBeenCalled();
  });

  it("should not rename when there is nothing to title from (no user message)", () => {
    h.thread.title = null;
    h.thread.messages = [];
    render(<ChatLayout />);

    emit("agent_start");
    emit("agent_end");

    expect(h.rename).not.toHaveBeenCalled();
  });

  it("should not rename on a bare agent_start with no run completion", () => {
    h.thread.title = null;
    h.thread.messages = [userMessage("what is my balance")];
    render(<ChatLayout />);

    emit("agent_start");

    expect(h.rename).not.toHaveBeenCalled();
  });
});
