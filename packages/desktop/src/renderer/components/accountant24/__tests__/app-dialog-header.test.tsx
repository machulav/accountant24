// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@/components/shadcn/dialog";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { AppDialogHeader } from "../app-dialog-header";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());

/** Render the header inside an open dialog (its DialogClose/Title need the
 *  Dialog context). showCloseButton={false} so the only Close is the header's. */
function renderHeader(title = "Settings") {
  const onOpenChange = vi.fn();
  render(
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="p-0">
        <AppDialogHeader title={title} />
      </DialogContent>
    </Dialog>,
  );
  return onOpenChange;
}

describe("AppDialogHeader", () => {
  it("should render the given title", () => {
    renderHeader("Add a skill");
    expect(screen.getByText("Add a skill")).toBeInTheDocument();
  });

  it("should render a single accessible Close control", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("should close the dialog when the Close control is clicked", () => {
    const onOpenChange = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalled();
    expect(onOpenChange.mock.calls[0][0]).toBe(false);
  });
});
