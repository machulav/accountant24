// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: the composer's model picker and @-mention popover read over the
// Electron bridge. Stub them so the thread (which always renders the composer)
// mounts without a real main process.
vi.mock("@/rpc/api", () => ({
  ledgerApi: { mentions: vi.fn().mockResolvedValue({ accounts: [], payees: [], tags: [] }) },
  settingsApi: {
    get: vi.fn().mockResolvedValue({ enabledModels: [], defaultModel: undefined }),
    onChange: () => () => {},
  },
  agentApi: { onModelsChanged: () => () => {} },
}));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { Thread, type ThreadComponents } from "../thread";

beforeAll(() => {
  installJsdomPolyfills();
  // The thread viewport calls scrollTo on mount; jsdom omits it.
  Element.prototype.scrollTo ??= () => {};
});
afterEach(() => cleanup());

type Msg = {
  id: string;
  role: "user" | "assistant";
  status?: { type: string; reason?: string };
  content: unknown[];
};

/** A real external-store assistant-ui runtime seeded with the given messages.
 *  `convertMessage: (m) => m` routes each message through the runtime's
 *  ThreadMessageLike normalizer. */
function Chrome({
  children,
  messages = [],
  isRunning = false,
  threadListLoading = false,
}: {
  children: ReactNode;
  messages?: Msg[];
  isRunning?: boolean;
  threadListLoading?: boolean;
}) {
  const store: ExternalStoreAdapter = {
    messages,
    isRunning,
    onNew: async () => {},
    convertMessage: (m: unknown) => m,
    // isNewChatView reads `threads.isLoading` — the startup placeholder branch
    // that shows the centered welcome before any message exists.
    adapters: threadListLoading ? { threadList: { isLoading: true } } : undefined,
  } as unknown as ExternalStoreAdapter;
  const runtime = useExternalStoreRuntime(store);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

const userMsg = (text: string): Msg => ({
  id: "u1",
  role: "user",
  content: [{ type: "text", text }],
});

const assistantText = (text: string): Msg => ({
  id: "a1",
  role: "assistant",
  status: { type: "complete" },
  content: [{ type: "text", text }],
});

/** An assistant turn that interleaves one reasoning step and one tool call. */
const chainMsg = (): Msg => ({
  id: "a1",
  role: "assistant",
  status: { type: "complete" },
  content: [
    { type: "reasoning", text: "Deciding which report to run" },
    { type: "tool-call", toolCallId: "t1", toolName: "query", args: {}, result: "ok" },
  ],
});

describe("Thread welcome vs. messages", () => {
  it("should show the welcome screen when the thread is empty", async () => {
    render(
      <Chrome threadListLoading>
        <Thread />
      </Chrome>,
    );
    expect(await screen.findByText("How can I help you today?")).toBeInTheDocument();
  });

  it("should show the messages and hide the welcome once the thread has content", async () => {
    render(
      <Chrome messages={[userMsg("what is my balance?")]}>
        <Thread />
      </Chrome>,
    );
    expect(await screen.findByText("what is my balance?")).toBeInTheDocument();
    expect(screen.queryByText("How can I help you today?")).toBeNull();
  });

  it("should render the assistant's answer text", async () => {
    render(
      <Chrome messages={[assistantText("Your balance is 100.")]}>
        <Thread />
      </Chrome>,
    );
    expect(await screen.findByText("Your balance is 100.")).toBeInTheDocument();
  });
});

describe("Thread assistant chain-of-thought", () => {
  it("should group reasoning and tool calls into a single chain-of-thought", async () => {
    render(
      <Chrome messages={[chainMsg()]}>
        <Thread />
      </Chrome>,
    );
    // One chain for two steps (reasoning + tool). Two separate chains would each
    // read "Worked through 1 step" instead.
    const triggers = await screen.findAllByText("Worked through 2 steps");
    expect(triggers).toHaveLength(1);
  });

  it("should reveal the reasoning step and the tool call when the chain is expanded", async () => {
    render(
      <Chrome messages={[chainMsg()]}>
        <Thread />
      </Chrome>,
    );
    fireEvent.click(await screen.findByText("Worked through 2 steps"));
    expect(await screen.findByText("Deciding which report to run")).toBeInTheDocument();
    // The tool call falls back to ToolFallback, which labels `query` as "Query Ledger".
    expect(screen.getByText("Query Ledger")).toBeInTheDocument();
  });
});

describe("Thread working indicator", () => {
  it("should expose the working indicator as a status region with an accessible label", async () => {
    render(
      <Chrome isRunning messages={[{ id: "a1", role: "assistant", status: { type: "running" }, content: [] }]}>
        <Thread />
      </Chrome>,
    );
    const status = await screen.findByRole("status", { name: "Assistant is working" });
    expect(status).toBeInTheDocument();
  });
});

describe("Thread component overrides", () => {
  it("should render a custom Welcome instead of the default on an empty thread", async () => {
    const components: ThreadComponents = { Welcome: () => <div>Fresh start</div> };
    render(
      <Chrome threadListLoading>
        <Thread components={components} />
      </Chrome>,
    );
    expect(await screen.findByText("Fresh start")).toBeInTheDocument();
    expect(screen.queryByText("How can I help you today?")).toBeNull();
  });

  it("should render a custom AssistantMessage instead of the default renderer", async () => {
    const components: ThreadComponents = { AssistantMessage: () => <div>custom assistant view</div> };
    render(
      <Chrome messages={[assistantText("original answer")]}>
        <Thread components={components} />
      </Chrome>,
    );
    expect(await screen.findByText("custom assistant view")).toBeInTheDocument();
    expect(screen.queryByText("original answer")).toBeNull();
  });

  it("should use a custom ToolFallback for tool calls that have no registered UI", async () => {
    const components: ThreadComponents = {
      ToolFallback: ({ toolName }) => <div>overridden: {toolName}</div>,
    };
    render(
      <Chrome messages={[chainMsg()]}>
        <Thread components={components} />
      </Chrome>,
    );
    fireEvent.click(await screen.findByText("Worked through 2 steps"));
    expect(await screen.findByText("overridden: query")).toBeInTheDocument();
    // The default ToolFallback label must not appear when overridden.
    expect(screen.queryByText("Query Ledger")).toBeNull();
  });
});
