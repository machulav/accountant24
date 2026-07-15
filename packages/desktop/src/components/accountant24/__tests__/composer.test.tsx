// @vitest-environment jsdom

// Spec for the composer: the paste-to-attach behavior (the Lexical input has no
// built-in equivalent of the textarea composer's addAttachmentOnPaste), the
// new-chat-view predicate, and the rendered action row (send vs cancel).

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// IPC boundary: the composer's model picker, @-mention popover, and `/` skills
// picker read over the Electron bridge. Stub them so the composer mounts without
// a real main process.
vi.mock("@/rpc/api", () => ({
  ledgerApi: { mentions: vi.fn().mockResolvedValue({ accounts: [], payees: [], tags: [] }) },
  skillsApi: { list: vi.fn().mockResolvedValue({ skills: [] }) },
  settingsApi: {
    get: vi.fn().mockResolvedValue({ enabledModels: [], defaultModel: undefined }),
    onChange: () => () => {},
  },
  agentApi: { onModelsChanged: () => () => {} },
}));

import {
  AssistantRuntimeProvider,
  type AssistantState,
  type ExternalStoreAdapter,
  SimpleImageAttachmentAdapter,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { Composer, EditComposer, handleComposerFilePaste, isNewChatView } from "../composer";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => cleanup());

const makeEvent = (files: File[] | undefined) => ({
  clipboardData: (files === undefined ? undefined : ({ files } as unknown as DataTransfer)) as DataTransfer,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
});

const makeAui = (attachments = true, addAttachment = vi.fn().mockResolvedValue(undefined)) => ({
  aui: {
    thread: () => ({ getState: () => ({ capabilities: { attachments } }) }),
    composer: () => ({ addAttachment }),
  },
  addAttachment,
});

const file = (name: string) => new File([new Uint8Array([1])], name, { type: "image/png" });

describe("handleComposerFilePaste()", () => {
  it("should attach every pasted file and swallow the paste event", () => {
    const { aui, addAttachment } = makeAui();
    const e = makeEvent([file("a.png"), file("b.png")]);
    handleComposerFilePaste(e, aui);
    expect(addAttachment).toHaveBeenCalledTimes(2);
    expect(addAttachment).toHaveBeenCalledWith(e.clipboardData.files[0]);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it("should let plain text pastes pass through untouched", () => {
    const { aui, addAttachment } = makeAui();
    const e = makeEvent([]);
    handleComposerFilePaste(e, aui);
    expect(addAttachment).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("should do nothing when the thread does not support attachments", () => {
    const { aui, addAttachment } = makeAui(false);
    const e = makeEvent([file("a.png")]);
    handleComposerFilePaste(e, aui);
    expect(addAttachment).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("should treat a paste with no clipboardData as an empty file set", () => {
    const { aui, addAttachment } = makeAui();
    const e = makeEvent(undefined);
    handleComposerFilePaste(e, aui);
    expect(addAttachment).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("should log an error when attaching a pasted file fails", async () => {
    const rejecting = vi.fn().mockRejectedValue(new Error("disk full"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { aui } = makeAui(true, rejecting);
    handleComposerFilePaste(makeEvent([file("a.png")]), aui);
    // The rejection is handled off the event, so let the microtask queue drain.
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith("Error adding attachment:", expect.any(Error));
    spy.mockRestore();
  });
});

/** Build a minimal AssistantState for the isNewChatView predicate. */
const state = (o: {
  messageCount?: number;
  mainThreadId?: string;
  newThreadId?: string;
  isLoading?: boolean;
}): AssistantState => {
  const { messageCount = 0, mainThreadId = "t1", newThreadId = "new", isLoading = false } = o;
  return {
    thread: { messages: Array.from({ length: messageCount }, (_, i) => ({ id: `m${i}` })) },
    threads: { mainThreadId, newThreadId, isLoading },
  } as unknown as AssistantState;
};

describe("isNewChatView()", () => {
  it("should be true for an empty, not-yet-created thread", () => {
    expect(isNewChatView(state({ messageCount: 0, mainThreadId: "new", newThreadId: "new" }))).toBe(true);
  });

  it("should be true while the thread list is still loading, even on another id", () => {
    expect(isNewChatView(state({ messageCount: 0, mainThreadId: "t1", newThreadId: "new", isLoading: true }))).toBe(
      true,
    );
  });

  it("should be false once the thread has messages", () => {
    expect(isNewChatView(state({ messageCount: 1, mainThreadId: "new", newThreadId: "new" }))).toBe(false);
  });

  it("should be false for an empty existing thread that is not loading", () => {
    expect(isNewChatView(state({ messageCount: 0, mainThreadId: "t1", newThreadId: "new", isLoading: false }))).toBe(
      false,
    );
  });
});

type Msg = { id: string; role: "user" | "assistant"; content: { type: "text"; text: string }[] };

function Chrome({
  children,
  isRunning = false,
  messages = [],
  attachments = false,
}: {
  children: ReactNode;
  isRunning?: boolean;
  messages?: Msg[];
  attachments?: boolean;
}) {
  const store: ExternalStoreAdapter = {
    messages,
    isRunning,
    onNew: async () => {},
    convertMessage: (m: unknown) => m,
    adapters: attachments ? { attachments: new SimpleImageAttachmentAdapter() } : undefined,
  } as unknown as ExternalStoreAdapter;
  const runtime = useExternalStoreRuntime(store);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

describe("<Composer />", () => {
  it("should offer a send button and a message input when the thread is idle", () => {
    render(
      <Chrome isRunning={false}>
        <Composer />
      </Chrome>,
    );
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
    expect(screen.getByLabelText("Message input")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop generating" })).not.toBeInTheDocument();
  });

  it("should swap the send button for a stop button while the thread is running", () => {
    render(
      <Chrome isRunning={true}>
        <Composer />
      </Chrome>,
    );
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
  });

  it("should route a file paste through the attach handler without inserting text", () => {
    render(
      <Chrome attachments>
        <Composer />
      </Chrome>,
    );
    const input = screen.getByLabelText("Message input");
    // A file paste is intercepted (preventDefault) instead of reaching the input.
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { files: [file("a.png")] },
    });
    fireEvent(input, paste);
    expect(paste.defaultPrevented).toBe(true);
  });
});

describe("<EditComposer />", () => {
  it("should offer Cancel and Update controls for the message being edited", () => {
    const userMsg: Msg = { id: "u1", role: "user", content: [{ type: "text", text: "hello" }] };
    render(
      <Chrome messages={[userMsg]}>
        <ThreadPrimitive.Messages components={{ UserMessage: EditComposer, AssistantMessage: () => null }} />
      </Chrome>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });
});
