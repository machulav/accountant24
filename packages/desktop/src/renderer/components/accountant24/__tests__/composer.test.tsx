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
  useAui,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/** A no-op dictation adapter: its presence flips `capabilities.dictation` on,
 *  and `listen()` returns a never-ending session so starting dictation moves the
 *  composer into the "dictating" state (swapping mic → stop). */
const makeDictationAdapter = () => ({
  listen: () => ({
    status: { type: "running" as const },
    stop: async () => {},
    cancel: () => {},
    onSpeechStart: () => () => {},
    onSpeechEnd: () => () => {},
    onSpeech: () => () => {},
  }),
});

/** The queue surface production exposes (react-pi's adapter); spies stand in
 *  so tests can assert the enqueue/clear calls the composer must make. */
const makeQueueAdapter = (items: { id: string; prompt: string }[] = []) => ({
  items,
  enqueue: vi.fn(),
  steer: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
});
type QueueAdapter = ReturnType<typeof makeQueueAdapter>;

/** The aui handle of the rendered runtime, for driving composer state the way
 *  the Lexical input would (jsdom cannot type into Lexical). */
let aui: ReturnType<typeof useAui> | undefined;
const CaptureAui = () => {
  aui = useAui();
  return null;
};

function Chrome({
  children,
  isRunning = false,
  messages = [],
  attachments = false,
  dictation = false,
  queue,
  onCancel,
}: {
  children: ReactNode;
  isRunning?: boolean;
  messages?: Msg[];
  attachments?: boolean;
  dictation?: boolean;
  queue?: QueueAdapter;
  onCancel?: () => Promise<void>;
}) {
  const adapters =
    attachments || dictation
      ? {
          ...(attachments ? { attachments: new SimpleImageAttachmentAdapter() } : {}),
          ...(dictation ? { dictation: makeDictationAdapter() } : {}),
        }
      : undefined;
  const store: ExternalStoreAdapter = {
    messages,
    isRunning,
    onNew: async () => {},
    ...(onCancel ? { onCancel } : {}),
    ...(queue ? { queue } : {}),
    convertMessage: (m: unknown) => m,
    adapters,
  } as unknown as ExternalStoreAdapter;
  const runtime = useExternalStoreRuntime(store);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <CaptureAui />
      {children}
    </AssistantRuntimeProvider>
  );
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

  it("should stay usable when the mention data query fails (no journal yet)", async () => {
    const { ledgerApi } = await import("@/rpc/api");
    vi.mocked(ledgerApi.mentions).mockRejectedValueOnce(new Error("hledger missing"));
    render(
      <Chrome isRunning={false}>
        <Composer />
      </Chrome>,
    );
    expect(await screen.findByLabelText("Message input")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("should show Stop in place of Send while running with an empty composer", () => {
    render(
      <Chrome isRunning={true} queue={makeQueueAdapter()}>
        <Composer />
      </Chrome>,
    );
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
  });

  it("should morph Stop into Send when text is entered mid-run", async () => {
    render(
      <Chrome isRunning={true} queue={makeQueueAdapter()}>
        <Composer />
      </Chrome>,
    );
    act(() => aui?.composer().setText("use 50 EUR"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Stop generating" })).not.toBeInTheDocument();
  });

  it("should morph Send back into Stop when the mid-run text is cleared", async () => {
    render(
      <Chrome isRunning={true} queue={makeQueueAdapter()}>
        <Composer />
      </Chrome>,
    );
    act(() => aui?.composer().setText("use 50 EUR"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument());
    act(() => aui?.composer().setText(""));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
  });

  it("should enqueue with steer intent when Send is clicked while running", async () => {
    const queue = makeQueueAdapter();
    render(
      <Chrome isRunning={true} queue={queue}>
        <Composer />
      </Chrome>,
    );
    act(() => aui?.composer().setText("use 50 EUR"));
    await userEvent.click(await screen.findByRole("button", { name: "Send message" }));

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    const [message, options] = queue.enqueue.mock.calls[0];
    expect(message).toMatchObject({ content: [{ type: "text", text: "use 50 EUR" }] });
    expect(options).toEqual({ steer: true });
  });

  it("should enqueue with steer intent when Send is clicked while idle", async () => {
    // Always-steer by design: pi only reads the flag during a run, so an idle
    // send is unchanged — and a send racing an unnoticed run start still steers.
    const queue = makeQueueAdapter();
    render(
      <Chrome isRunning={false} queue={queue}>
        <Composer />
      </Chrome>,
    );
    act(() => aui?.composer().setText("hi"));
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(queue.enqueue.mock.calls[0][1]).toEqual({ steer: true });
  });

  it("should restore the pending queued text into the composer when Stop is clicked", async () => {
    const queue = makeQueueAdapter([{ id: "steer:0", prompt: "use 50 EUR" }]);
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(
      <Chrome isRunning={true} queue={queue} onCancel={onCancel}>
        <Composer />
      </Chrome>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Stop generating" }));

    expect(aui?.composer().getState().text).toBe("use 50 EUR");
    expect(queue.clear).toHaveBeenCalledWith("cancel-run");
    expect(onCancel).toHaveBeenCalled();
  });

  // A Stop click with a typed draft is unreachable now (the slot shows Send);
  // the draft-wins guard is covered by restoreQueuedDraft()'s own unit specs.

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

  it("should not offer a voice-input control when the thread has no dictation adapter", () => {
    render(
      <Chrome>
        <Composer />
      </Chrome>,
    );
    expect(screen.queryByRole("button", { name: "Start voice input" })).toBeNull();
  });

  it("should offer a voice-input control when the thread supports dictation", () => {
    render(
      <Chrome dictation>
        <Composer />
      </Chrome>,
    );
    expect(screen.getByRole("button", { name: "Start voice input" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop voice input" })).toBeNull();
  });

  // Note: driving dictation from "start" to the "recording" state needs a real
  // dictation runtime (mic/MediaRecorder), which jsdom can't provide — the
  // presence/absence of the control is covered above; the live toggle is left to E2E.
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
