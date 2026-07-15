// @vitest-environment jsdom

import {
  AssistantRuntimeProvider,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { MessageError } from "../message-error";

beforeAll(() => {
  installJsdomPolyfills();
});

afterEach(() => {
  cleanup();
});

/** Render MessageError inside a real assistant-ui thread whose single assistant
 *  message carries the given status. Messages renders its child once per message,
 *  within that message's context — the same context MessageError reads from. */
function renderWithMessage(message: ThreadMessageLike) {
  function Chrome({ children }: { children: ReactNode }) {
    const store: ExternalStoreAdapter<ThreadMessageLike> = {
      messages: [message],
      // With a convertMessage the runtime normalizes each entry through
      // fromThreadMessageLike, which preserves the assistant status we set
      // (without it, raw entries bypass status handling entirely).
      convertMessage: (m) => m,
      onNew: async () => {},
    };
    const runtime = useExternalStoreRuntime(store);
    return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
  }
  return render(
    <Chrome>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages components={{ Message: () => <MessageError /> }} />
      </ThreadPrimitive.Root>
    </Chrome>,
  );
}

const erroredMessage = (error?: string): ThreadMessageLike => ({
  role: "assistant",
  content: [{ type: "text", text: "" }],
  status: { type: "incomplete", reason: "error", ...(error !== undefined ? { error } : {}) },
});

describe("MessageError", () => {
  it("should render the error text when the message failed", () => {
    renderWithMessage(erroredMessage("The model request failed"));
    expect(screen.getByText("The model request failed")).toBeInTheDocument();
  });

  it("should show a generic message when the failure carries no detail", () => {
    // useMessageError falls back to "An error occurred" for an error status
    // without an explicit message.
    renderWithMessage(erroredMessage());
    expect(screen.getByText("An error occurred")).toBeInTheDocument();
  });

  it("should render nothing when the message completed successfully", () => {
    const { container } = renderWithMessage({
      role: "assistant",
      content: [{ type: "text", text: "All good" }],
      status: { type: "complete", reason: "stop" },
    });
    // No error → MessagePrimitive.Error renders no children, so the thread
    // wrapper stays empty (nothing visible to the user).
    expect(container.textContent).toBe("");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("should render nothing when a non-error incomplete status is present", () => {
    const { container } = renderWithMessage({
      role: "assistant",
      content: [{ type: "text", text: "Stopped" }],
      status: { type: "incomplete", reason: "cancelled" },
    });
    // Only reason "error" surfaces a banner; a cancellation must not.
    expect(container.textContent).toBe("");
    expect(container.querySelector("svg")).toBeNull();
  });
});
