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
  // The composer's `/` skills picker lists skills over IPC.
  pluginsApi: { list: vi.fn().mockResolvedValue({ plugins: [] }), onEvent: vi.fn(async () => () => {}) },
  settingsApi: {
    get: vi.fn().mockResolvedValue({ enabledModels: [], defaultModel: undefined }),
    onChange: () => () => {},
  },
  agentApi: { onModelsChanged: () => () => {} },
}));

// The chain-of-thought timer reads the raw pi transcript (per-turn timestamps)
// and the compaction indicator reads the compaction flag, both through
// usePiThreadState. Stub just that hook so specs can supply the state;
// everything else in react-pi stays real.
const pi = vi.hoisted(() => ({
  transcript: [] as { role: string; timestamp?: number }[],
  compaction: { active: false },
  threadId: "/ws/sessions/t1.jsonl",
}));
vi.mock("@assistant-ui/react-pi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@assistant-ui/react-pi")>()),
  usePiThreadState: (
    selector: (st: { messages: unknown[]; compaction: { active: boolean }; threadId: string }) => unknown,
  ) => selector({ messages: pi.transcript, compaction: pi.compaction, threadId: pi.threadId }),
}));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { encodeAttachmentRef } from "@/lib/attachmentMarker";
import { addPendingCompactionMarker, resetPendingCompactionMarkers } from "@/runtime/pendingCompaction";
import { Thread, type ThreadComponents } from "../thread";

beforeAll(() => {
  installJsdomPolyfills();
  // The thread viewport calls scrollTo on mount; jsdom omits it.
  Element.prototype.scrollTo ??= () => {};
});
afterEach(() => {
  cleanup();
  pi.transcript = [];
  pi.compaction = { active: false };
  resetPendingCompactionMarkers();
});

type Msg = {
  id: string;
  role: "user" | "assistant";
  status?: { type: string; reason?: string };
  createdAt?: Date;
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

describe("Thread user message attachments", () => {
  const marker = encodeAttachmentRef({ name: "07 Beleg.pdf", path: "files/2026/08/20260806120000.pdf" });
  const attachmentsRow = () => document.querySelector('[data-slot="aui_user-attachments"]');
  const bubbleContent = () => document.querySelector('[data-role="user"] [data-slot="bubble-content"]');

  it("should render a file-only message as a card in the attachment row with an empty bubble", async () => {
    render(
      <Chrome messages={[userMsg(marker)]}>
        <Thread />
      </Chrome>,
    );
    expect(await screen.findByText("07 Beleg.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    // The card lives in the row above the bubble, never inside it.
    expect(attachmentsRow()?.querySelector('[data-slot="attachment"]')).not.toBeNull();
    // The bubble has nothing left to say (its CSS hides it when empty).
    expect(bubbleContent()).toBeEmptyDOMElement();
  });

  it("should render the card above the bubble and the text inside it for a mixed message", async () => {
    render(
      <Chrome messages={[userMsg(`paid this from my checking account\n${marker}`)]}>
        <Thread />
      </Chrome>,
    );
    expect(await screen.findByText("paid this from my checking account")).toBeInTheDocument();
    expect(attachmentsRow()?.querySelector('[data-slot="attachment"]')).not.toBeNull();
    expect(bubbleContent()?.textContent).toBe("paid this from my checking account");
    // The raw marker line never shows.
    expect(screen.queryByText(marker)).toBeNull();
  });

  it("should render a sent image in the attachment row, not in the bubble", async () => {
    render(
      <Chrome messages={[{ id: "u1", role: "user", content: [{ type: "image", image: "data:image/png;base64,AA" }] }]}>
        <Thread />
      </Chrome>,
    );
    expect(await screen.findByAltText("attachment")).toBeInTheDocument();
    expect(attachmentsRow()?.querySelector("img")).not.toBeNull();
    expect(bubbleContent()?.querySelector("img")).toBeNull();
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

  it("should show each cycle's own working time when a message holds two chains (A-32)", async () => {
    // Raw pi transcript: user(0.5s) → turn1 thinking+answer(1.5s) → turn2
    // thinking+tool(61.5s) → toolResult(120s) → turn4 final answer(121.5s).
    pi.transcript = [
      { role: "user", timestamp: 500 },
      { role: "assistant", timestamp: 1_500 },
      { role: "assistant", timestamp: 61_500 },
      { role: "toolResult", timestamp: 120_000 },
      { role: "assistant", timestamp: 121_500 },
    ];
    const messages: Msg[] = [
      { id: "u1", role: "user", createdAt: new Date(500), content: [{ type: "text", text: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        status: { type: "complete" },
        content: [
          { type: "reasoning", text: "First pass", parentId: "pi-step:1" },
          { type: "text", text: "Here is a first answer.", parentId: "pi-step:1" },
          { type: "reasoning", text: "Digging deeper", parentId: "pi-step:2" },
          { type: "tool-call", toolCallId: "t1", toolName: "query", args: {}, result: "ok", parentId: "pi-step:2" },
          { type: "text", text: "Final answer.", parentId: "pi-step:4" },
        ],
      },
    ];
    render(
      <Chrome messages={messages}>
        <Thread />
      </Chrome>,
    );
    // Cycle 1: user message (0.5s) → first answer's turn (1.5s).
    expect(await screen.findByText("Worked for 1s")).toBeInTheDocument();
    // Cycle 2: its own turn (61.5s) → final answer's turn (121.5s) — NOT the
    // accumulated 121s span from the user message.
    expect(screen.getByText("Worked for 1m 0s")).toBeInTheDocument();
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

describe("Thread compaction marker", () => {
  /** A running assistant turn mid-chain (reasoning + tool, nothing answered yet). */
  const runningChainMsg = (): Msg => ({
    id: "a1",
    role: "assistant",
    status: { type: "running" },
    content: [
      { type: "reasoning", text: "Deciding which report to run" },
      { type: "tool-call", toolCallId: "t1", toolName: "query", args: {}, result: "ok" },
    ],
  });

  /** The transcript message pi persists for a finished compaction. */
  const markerMsg = (): Msg => ({
    id: "m1",
    role: "assistant",
    content: [
      {
        type: "data",
        name: "pi-compaction-summary",
        data: { summary: "Earlier: reviewed Q1 spending.", tokensBefore: 31000 },
      },
    ],
  });

  describe("while compacting", () => {
    it("should show the status divider inside the last message when a compaction runs mid-run", async () => {
      pi.compaction = { active: true };
      render(
        <Chrome isRunning messages={[runningChainMsg()]}>
          <Thread />
        </Chrome>,
      );
      const label = await screen.findByText("Compacting conversation");
      const divider = label.closest('[data-slot="aui_compaction-indicator"]') as HTMLElement;
      expect(divider.getAttribute("role")).toBe("status");
      // In the last message's content flow: the turn anchor stretches the last
      // message root, so a stream-level sibling would land below the stretch.
      expect(divider.closest("[data-role=assistant]")).not.toBeNull();
    });

    it("should show the status divider when the running last message has no timeline yet", async () => {
      pi.compaction = { active: true };
      render(
        <Chrome isRunning messages={[{ id: "a1", role: "assistant", status: { type: "running" }, content: [] }]}>
          <Thread />
        </Chrome>,
      );
      expect(await screen.findByText("Compacting conversation")).toBeInTheDocument();
    });

    it("should show the status divider under a finished last message (post-turn threshold compaction)", async () => {
      pi.compaction = { active: true };
      render(
        <Chrome messages={[chainMsg()]}>
          <Thread />
        </Chrome>,
      );
      expect(await screen.findByText("Worked through 2 steps")).toBeInTheDocument();
      expect(screen.getByText("Compacting conversation")).toBeInTheDocument();
    });

    it("should switch to the settled label in place while the marker is still parked", async () => {
      // Compaction finished (flag off) but the transcript marker is deferred
      // until the next prompt — the divider must settle in place, not vanish.
      addPendingCompactionMarker(pi.threadId, { summary: "s", timestamp: 1000 });
      render(
        <Chrome messages={[chainMsg()]}>
          <Thread />
        </Chrome>,
      );
      expect(await screen.findByText("Conversation compacted")).toBeInTheDocument();
      expect(screen.queryByText("Compacting conversation")).toBeNull();
    });

    it("should show nothing once the parked marker was consumed", async () => {
      render(
        <Chrome messages={[chainMsg()]}>
          <Thread />
        </Chrome>,
      );
      expect(await screen.findByText("Worked through 2 steps")).toBeInTheDocument();
      expect(screen.queryByText("Conversation compacted")).toBeNull();
    });

    it("should not show the status divider when no compaction is running", async () => {
      render(
        <Chrome isRunning messages={[runningChainMsg()]}>
          <Thread />
        </Chrome>,
      );
      expect(await screen.findByText("Working")).toBeInTheDocument();
      expect(screen.queryByText("Compacting conversation")).toBeNull();
    });

    it("should not show the status divider on a message that is not the last one", async () => {
      pi.compaction = { active: true };
      render(
        <Chrome messages={[chainMsg(), userMsg("next question")]}>
          <Thread />
        </Chrome>,
      );
      expect(await screen.findByText("next question")).toBeInTheDocument();
      expect(screen.queryByText("Compacting conversation")).toBeNull();
    });
  });

  describe("once compacted", () => {
    it("should render the marker from the transcript message, with no summary details", async () => {
      render(
        <Chrome messages={[markerMsg()]}>
          <Thread />
        </Chrome>,
      );
      expect(await screen.findByText("Conversation compacted")).toBeInTheDocument();
      expect(screen.queryByText("Earlier: reviewed Q1 spending.")).toBeNull();
    });

    it("should keep the marker between the work before and after it", async () => {
      render(
        <Chrome messages={[chainMsg(), markerMsg(), userMsg("next question")]}>
          <Thread />
        </Chrome>,
      );
      const marker = await screen.findByText("Conversation compacted");
      const order = [...document.querySelectorAll("[data-role], [data-slot=aui_compaction-summary]")];
      expect(order.indexOf(marker.closest("[data-slot=aui_compaction-summary]") as Element)).toBeGreaterThan(0);
      expect(screen.getByText("next question")).toBeInTheDocument();
    });

    it("should not shimmer once settled", async () => {
      render(
        <Chrome messages={[markerMsg()]}>
          <Thread />
        </Chrome>,
      );
      expect((await screen.findByText("Conversation compacted")).className).not.toContain("shimmer");
    });
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
