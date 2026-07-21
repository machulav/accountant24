// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { MarkdownTable } from "../markdown-table";

beforeAll(() => {
  installJsdomPolyfills();
  // Base UI Dialog probes pointer-capture APIs jsdom omits.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => cleanup());

/** Render the markdown table renderer with a two-column, one-row GFM table —
 *  the same th/td/tr shape react-markdown feeds it. */
const drawTable = () =>
  render(
    <MarkdownTable>
      <thead>
        <tr>
          <th>Account</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Cash</td>
          <td>100</td>
        </tr>
      </tbody>
    </MarkdownTable>,
  );

describe("MarkdownTable", () => {
  describe("rendering", () => {
    it("should render the column headers as columnheader cells", () => {
      drawTable();
      expect(screen.getByRole("columnheader", { name: "Account" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Amount" })).toBeInTheDocument();
    });

    it("should render the data cells as table cells", () => {
      drawTable();
      expect(screen.getByRole("cell", { name: "Cash" })).toBeInTheDocument();
      expect(screen.getByRole("cell", { name: "100" })).toBeInTheDocument();
    });

    it("should render a single table when collapsed (no expanded dialog copy)", () => {
      drawTable();
      expect(screen.getAllByRole("table")).toHaveLength(1);
    });

    it("should expose an 'Expand table' and a 'Download CSV' action button", () => {
      drawTable();
      expect(screen.getByRole("button", { name: "Expand table" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Download CSV" })).toBeInTheDocument();
    });
  });

  describe("expand toggle", () => {
    it("should not show the expanded dialog before the expand button is clicked", () => {
      drawTable();
      expect(screen.queryByText("Expanded table view")).toBeNull();
    });

    it("should open a dialog with a second copy of the table when Expand is clicked", () => {
      drawTable();
      fireEvent.click(screen.getByRole("button", { name: "Expand table" }));

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("Expanded table view")).toBeInTheDocument();
      // The dialog mounts an identical copy of the table (the inline table is
      // marked aria-hidden by the modal, so it drops out of the a11y tree).
      expect(within(dialog).getByRole("table")).toBeInTheDocument();
      expect(within(dialog).getByRole("columnheader", { name: "Account" })).toBeInTheDocument();
      expect(within(dialog).getByRole("cell", { name: "Cash" })).toBeInTheDocument();
    });

    it("should close the expanded dialog when the Close button is clicked", async () => {
      drawTable();
      fireEvent.click(screen.getByRole("button", { name: "Expand table" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByText("Expanded table view")).toBeNull());
    });
  });

  describe("download CSV", () => {
    let createObjectURL: ReturnType<typeof vi.fn>;
    let revokeObjectURL: ReturnType<typeof vi.fn>;
    let clickSpy: ReturnType<typeof vi.spyOn>;
    let origCreate: typeof URL.createObjectURL | undefined;
    let origRevoke: typeof URL.revokeObjectURL | undefined;
    const blobs: Blob[] = [];

    beforeEach(() => {
      blobs.length = 0;
      origCreate = URL.createObjectURL;
      origRevoke = URL.revokeObjectURL;
      createObjectURL = vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:mock-url";
      });
      revokeObjectURL = vi.fn();
      URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
      // Prevent jsdom "Not implemented: navigation" and capture the anchor.
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });

    afterEach(() => {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreate as typeof URL.createObjectURL;
      URL.revokeObjectURL = origRevoke as typeof URL.revokeObjectURL;
    });

    it("should trigger exactly one anchor download when Download CSV is clicked", () => {
      drawTable();
      fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it("should name the downloaded file 'table.csv'", () => {
      drawTable();
      fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
      const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toBe("table.csv");
      expect(anchor.href).toContain("blob:mock-url");
    });

    it("should serialize the header row and data row separated by CRLF", async () => {
      drawTable();
      fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
      // Blob.text() applies the UTF-8 decode algorithm, which strips a leading
      // BOM — so the decoded payload is the CSV without it.
      const text = await blobs[0].text();
      expect(text).toBe("Account,Amount\r\nCash,100");
    });

    it("should prepend a UTF-8 BOM to the CSV bytes so Excel reads it correctly", async () => {
      drawTable();
      fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
      const bytes = new Uint8Array(await blobs[0].arrayBuffer());
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    });

    it("should revoke the object URL after triggering the download", () => {
      drawTable();
      fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    });

    it("should not leave the download anchor attached to the document", () => {
      drawTable();
      fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
      expect(document.querySelector("a[download='table.csv']")).toBeNull();
    });
  });
});
