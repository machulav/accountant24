// @vitest-environment jsdom

// Spec for the `/` skills popover UI: a flat, keyboard-navigable list that opens
// only for a *leading* slash, renders Built-in/Custom section labels on group
// boundaries, and shows an empty label when nothing matches. The grouping helper
// (groupSkillRows) is unit-tested in composer-skills.test.tsx; this file covers
// the rendered popover itself.

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  type ExternalStoreAdapter,
  type Unstable_TriggerItem,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { ComposerSkillsPopover, type SkillsTriggerAdapter } from "../composer-skills-popover";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
});

const MIXED_SKILLS: Unstable_TriggerItem[] = [
  { id: "pdf", type: "skill", label: "pdf", description: "Read PDF files.", metadata: { native: true } },
  { id: "invoices", type: "skill", label: "invoices", description: "Draft invoices.", metadata: { native: false } },
];

/** A flat skills adapter: no categories, a search that filters on the label
 *  (empty query lists everything) — the same shape createSkillsAdapter produces. */
const makeAdapter = (items: Unstable_TriggerItem[] = MIXED_SKILLS): SkillsTriggerAdapter => ({
  categories: () => [],
  categoryItems: () => [],
  search: (query) => {
    const q = query.toLowerCase();
    return q ? items.filter((item) => item.label.toLowerCase().includes(q)) : items;
  },
});

/** A composer hosting the `/` skills popover. Like the real composer, the popover
 *  only arms when the trigger char is active at the cursor, so we render a live
 *  input to type into. */
function Picker({ adapter, emptyLabel }: { adapter: SkillsTriggerAdapter; emptyLabel: string }) {
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root>
        <ComposerPrimitive.Input />
        <ComposerSkillsPopover adapter={adapter} emptyLabel={emptyLabel} />
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}

function renderPicker(adapter = makeAdapter(), emptyLabel = "No skills yet. Add them in Settings → Skills") {
  function Chrome({ children }: { children: ReactNode }) {
    const store: ExternalStoreAdapter = { messages: [], onNew: async () => {} };
    const runtime = useExternalStoreRuntime(store);
    return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
  }
  render(
    <Chrome>
      <Picker adapter={adapter} emptyLabel={emptyLabel} />
    </Chrome>,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

/** Type `value` into the composer and place the cursor at its end — the signals
 *  the trigger detector reads to decide the trigger is active. */
const type = (input: HTMLTextAreaElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  input.selectionStart = value.length;
  input.selectionEnd = value.length;
  fireEvent.select(input);
};

describe("ComposerSkillsPopover", () => {
  it("should stay closed until a slash is typed", () => {
    renderPicker();
    expect(screen.queryByText("pdf")).toBeNull();
    expect(screen.queryByText("invoices")).toBeNull();
  });

  it("should open and list every skill when a leading slash is typed", async () => {
    const input = renderPicker();
    type(input, "/");
    await waitFor(() => expect(screen.getByText("pdf")).toBeInTheDocument());
    expect(screen.getByText("invoices")).toBeInTheDocument();
  });

  it("should show each skill's description subtitle", async () => {
    const input = renderPicker();
    type(input, "/");
    await waitFor(() => expect(screen.getByText("Read PDF files.")).toBeInTheDocument());
    expect(screen.getByText("Draft invoices.")).toBeInTheDocument();
  });

  it("should label the Built-in and Custom groups when both are present", async () => {
    const input = renderPicker();
    type(input, "/");
    await waitFor(() => expect(screen.getByText("Built-in")).toBeInTheDocument());
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("should not draw group labels for a homogeneous list", async () => {
    const input = renderPicker(
      makeAdapter([{ id: "pdf", type: "skill", label: "pdf", description: "Read PDFs.", metadata: { native: true } }]),
    );
    type(input, "/");
    await waitFor(() => expect(screen.getByText("pdf")).toBeInTheDocument());
    expect(screen.queryByText("Built-in")).toBeNull();
    expect(screen.queryByText("Custom")).toBeNull();
  });

  it("should show the empty label when the query matches no skill", async () => {
    const input = renderPicker();
    type(input, "/zzz");
    await waitFor(() => expect(screen.getByText("No skills yet. Add them in Settings → Skills")).toBeInTheDocument());
  });

  it("should filter the list down to the matching skill as the query narrows", async () => {
    const input = renderPicker();
    type(input, "/pdf");
    await waitFor(() => expect(screen.getByText("pdf")).toBeInTheDocument());
    expect(screen.queryByText("invoices")).toBeNull();
  });

  it("should not arm the picker for a slash inside a word (URLs, and/or)", async () => {
    const input = renderPicker();
    // pi only expands a *leading* skill token, so a `/` inside other text stays
    // literal and never offers the picker.
    type(input, "http://example");
    await waitFor(() => expect(screen.queryByText("pdf")).toBeNull());
  });

  it("should dismiss the popover once a skill is selected", async () => {
    const input = renderPicker();
    type(input, "/");
    await waitFor(() => expect(screen.getByText("pdf")).toBeInTheDocument());
    fireEvent.click(screen.getByText("pdf"));
    await waitFor(() => expect(screen.queryByText("invoices")).toBeNull());
  });
});
