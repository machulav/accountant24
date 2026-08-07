// @vitest-environment jsdom

// Spec for the shared Columns menu: a "Columns" trigger opening a checkbox
// list of the configured columns, reporting toggles without closing (a
// multi-column choice happens in one visit).

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { ColumnsMenu } from "../columns-menu";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => cleanup());

const COLUMNS = [
  { id: "one", label: "First column" },
  { id: "two", label: "Second column" },
];

describe("<ColumnsMenu />", () => {
  it("should list the configured columns with their visibility, treating a missing id as hidden", async () => {
    render(<ColumnsMenu columns={COLUMNS} visibility={{ one: true }} onToggle={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "First column" })).toBeChecked();
    expect(screen.getByRole("menuitemcheckbox", { name: "Second column" })).not.toBeChecked();
  });

  it("should report toggles per column id and keep the menu open between them", async () => {
    const onToggle = vi.fn();
    render(<ColumnsMenu columns={COLUMNS} visibility={{ one: true, two: false }} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "First column" }));
    expect(onToggle).toHaveBeenLastCalledWith("one", false);
    // Still open: the second toggle needs no reopen.
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Second column" }));
    expect(onToggle).toHaveBeenLastCalledWith("two", true);
  });
});
