// @vitest-environment jsdom

// Spec for the composer's queued-message chips: one chip per message pending
// in pi's queue (mid-run sends waiting for the next tool boundary), rendering
// directives as pills, and nothing at all when the queue is empty.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// IPC boundary: the mention pill module reads ledger data over the Electron
// bridge on import; stub it so the chip renders without a main process.
vi.mock("@/rpc/api", () => ({
  ledgerApi: { mentions: vi.fn().mockResolvedValue({ accounts: [], payees: [], tags: [] }) },
}));

import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { ComposerQueuedMessages } from "../composer-queue";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());

/** A runtime whose queue adapter holds the given pending items. */
function Chrome({ items }: { items: { id: string; prompt: string }[] }) {
  const store: ExternalStoreAdapter = {
    messages: [],
    isRunning: true,
    onNew: async () => {},
    queue: { items, enqueue: () => {}, steer: () => {}, remove: () => {}, clear: () => {} },
    convertMessage: (m: unknown) => m,
  } as unknown as ExternalStoreAdapter;
  const runtime = useExternalStoreRuntime(store);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerQueuedMessages />
    </AssistantRuntimeProvider>
  );
}

describe("<ComposerQueuedMessages />", () => {
  it("should render a chip for each pending queued message", () => {
    render(
      <Chrome
        items={[
          { id: "steer:0", prompt: "use 50 EUR" },
          { id: "steer:1", prompt: "and rename it" },
        ]}
      />,
    );
    expect(screen.getByText("use 50 EUR")).toBeInTheDocument();
    expect(screen.getByText("and rename it")).toBeInTheDocument();
  });

  it("should render a skill directive in the queued text as a skill pill", () => {
    render(<Chrome items={[{ id: "steer:0", prompt: ":skill[pdf] check this" }]} />);
    const pill = screen.getByText("pdf");
    expect(pill.closest("[data-directive-type='skill']")).not.toBeNull();
    expect(screen.getByText("check this")).toBeInTheDocument();
  });

  it("should render nothing when the queue is empty", () => {
    const { container } = render(<Chrome items={[]} />);
    expect(container.querySelector("[data-slot='aui_composer-queue-chip']")).toBeNull();
  });
});
