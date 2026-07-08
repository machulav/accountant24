// @vitest-environment jsdom

import {
  type AssistantRuntime,
  AssistantRuntimeProvider,
  type ExternalStoreAdapter,
  SimpleImageAttachmentAdapter,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ComposerAttachments } from "../attachment";

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  // jsdom has no object URLs; the preview hook needs both ends.
  URL.createObjectURL ??= () => "blob:preview";
  URL.revokeObjectURL ??= () => {};
});

afterEach(() => {
  cleanup();
});

let runtime: AssistantRuntime;

function Chrome({ children }: { children: ReactNode }) {
  const store: ExternalStoreAdapter = {
    messages: [],
    onNew: async () => {},
    adapters: { attachments: new SimpleImageAttachmentAdapter() },
  };
  runtime = useExternalStoreRuntime(store);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

const addImage = async (name: string) => {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
  await act(() => runtime.thread.composer.addAttachment(file));
};

describe("ComposerAttachments", () => {
  it("should render nothing visible while there are no attachments", () => {
    render(
      <Chrome>
        <ComposerAttachments />
      </Chrome>,
    );
    expect(document.querySelectorAll('[data-slot="attachment"]')).toHaveLength(0);
  });

  it("should show a chip with the file name after attaching", async () => {
    render(
      <Chrome>
        <ComposerAttachments />
      </Chrome>,
    );
    await addImage("receipt.png");
    await screen.findByText("receipt.png");
    expect(document.querySelectorAll('[data-slot="attachment"]')).toHaveLength(1);
  });

  it("should remove the chip when its remove button is clicked", async () => {
    render(
      <Chrome>
        <ComposerAttachments />
      </Chrome>,
    );
    await addImage("receipt.png");
    await screen.findByText("receipt.png");
    fireEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
    await waitFor(() => expect(screen.queryByText("receipt.png")).toBeNull());
  });

  it("should show one chip per attached file", async () => {
    render(
      <Chrome>
        <ComposerAttachments />
      </Chrome>,
    );
    await addImage("a.png");
    await addImage("b.png");
    await screen.findByText("b.png");
    expect(document.querySelectorAll('[data-slot="attachment"]')).toHaveLength(2);
  });
});
