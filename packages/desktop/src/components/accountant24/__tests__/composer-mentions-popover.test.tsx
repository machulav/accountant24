// @vitest-environment jsdom

import {
  type AssistantRuntime,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  type ExternalStoreAdapter,
  unstable_useMentionAdapter,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LandmarkIcon } from "lucide-react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { ComposerMentionsPopover } from "../composer-mentions-popover";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
});

const CATEGORIES = [
  {
    id: "accounts",
    label: "Accounts",
    items: [
      { id: "Assets:Cash", type: "account", label: "Assets:Cash", icon: "account", description: "Cash on hand" },
      { id: "Assets:Bank", type: "account", label: "Assets:Bank", icon: "account" },
    ],
  },
  {
    id: "payees",
    label: "Payees",
    items: [{ id: "Acme", type: "payee", label: "Acme", icon: "payee" }],
  },
];

let runtime: AssistantRuntime;

/** A composer that hosts the `@` mentions popover, fed the given categories. The
 *  popover only opens when the trigger char is active at the cursor in a real
 *  composer input, so we render a live ComposerPrimitive.Input to type into. The
 *  mention adapter carries the `@` trigger char (no explicit `char` prop). */
function Picker({ categories, emptyLabel }: { categories: typeof CATEGORIES; emptyLabel: string }) {
  const mention = unstable_useMentionAdapter({
    categories,
    includeModelContextTools: false,
    iconMap: { accounts: LandmarkIcon },
  });
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root>
        <ComposerPrimitive.Input />
        <ComposerMentionsPopover {...mention} emptyItemsLabel={emptyLabel} />
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}

function renderPicker(categories = CATEGORIES, emptyLabel = "No matching items") {
  function Chrome({ children }: { children: ReactNode }) {
    const store: ExternalStoreAdapter = { messages: [], onNew: async () => {} };
    runtime = useExternalStoreRuntime(store);
    return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
  }
  render(
    <Chrome>
      <Picker categories={categories} emptyLabel={emptyLabel} />
    </Chrome>,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

/** Type `value` into the composer and place the cursor at its end — the two
 *  signals (text + caret) the trigger detector reads to decide it is active. */
const type = (input: HTMLTextAreaElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  input.selectionStart = value.length;
  input.selectionEnd = value.length;
  fireEvent.select(input);
};

describe("ComposerMentionsPopover", () => {
  it("should stay closed until the trigger char is typed", () => {
    renderPicker();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText("Accounts")).toBeNull();
  });

  it("should open the popover when the trigger char is typed", async () => {
    const input = renderPicker();
    type(input, "@");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
  });

  it("should render every provided category once open", async () => {
    const input = renderPicker();
    type(input, "@");
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());
    expect(screen.getByText("Payees")).toBeInTheDocument();
  });

  it("should close again when the trigger char is removed", async () => {
    const input = renderPicker();
    type(input, "@");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    type(input, "");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("should show the configured empty label when there is nothing to offer", async () => {
    const input = renderPicker([], "Nothing here");
    type(input, "@");
    await waitFor(() => expect(screen.getByText("Nothing here")).toBeInTheDocument());
  });

  it("should drill into a category to reveal its items when the category is chosen", async () => {
    const input = renderPicker();
    type(input, "@");
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Accounts"));
    await waitFor(() => expect(screen.getByText("Assets:Cash")).toBeInTheDocument());
    expect(screen.getByText("Assets:Bank")).toBeInTheDocument();
    // Sibling categories are no longer offered once drilled in.
    expect(screen.queryByText("Payees")).toBeNull();
  });

  it("should show an item's description subtitle when present", async () => {
    const input = renderPicker();
    type(input, "@");
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Accounts"));
    await waitFor(() => expect(screen.getByText("Cash on hand")).toBeInTheDocument());
  });

  it("should offer a Back control that returns from items to the category list", async () => {
    const input = renderPicker();
    type(input, "@");
    await waitFor(() => expect(screen.getByText("Accounts")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Accounts"));
    await waitFor(() => expect(screen.getByText("Assets:Cash")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(screen.getByText("Payees")).toBeInTheDocument());
    expect(screen.getByText("Accounts")).toBeInTheDocument();
  });

  it("should show the empty-items label when a drilled-in category has nothing to match", async () => {
    const input = renderPicker(
      [{ id: "empty", label: "Empty", items: [] }] as unknown as typeof CATEGORIES,
      "No matching items",
    );
    type(input, "@");
    await waitFor(() => expect(screen.getByText("Empty")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Empty"));
    await waitFor(() => expect(screen.getByText("No matching items")).toBeInTheDocument());
  });
});
