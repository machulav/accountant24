// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "../code-block";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(cleanup);

describe("CodeBlock", () => {
  it("should render its text content inside a pre element", () => {
    render(<CodeBlock>{'{ "a": 1 }'}</CodeBlock>);
    const pre = screen.getByText('{ "a": 1 }');
    expect(pre.tagName).toBe("PRE");
  });

  it("should scroll wide content horizontally instead of wrapping", () => {
    render(<CodeBlock>wide report</CodeBlock>);
    expect(screen.getByText("wide report").className).toContain("overflow-x-auto");
    expect(screen.getByText("wide report").className).not.toContain("whitespace-pre-wrap");
  });

  describe("copy button", () => {
    it("should copy the displayed text to the clipboard when clicked", async () => {
      render(<CodeBlock>copy me</CodeBlock>);
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("copy me"));
    });

    it("should prefer copyText over the rendered children when provided", async () => {
      render(<CodeBlock copyText="raw text">formatted text</CodeBlock>);
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("raw text"));
    });

    it("should switch to the copied state after a successful copy", async () => {
      render(<CodeBlock>copy me</CodeBlock>);
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    });

    it("should not copy again while in the copied state", async () => {
      render(<CodeBlock>copy me</CodeBlock>);
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      const copied = await screen.findByRole("button", { name: "Copied" });
      fireEvent.click(copied);
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    it("should not render a copy button when children are not plain text", () => {
      render(
        <CodeBlock>
          <span>jsx content</span>
        </CodeBlock>,
      );
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("should render a copy button for jsx children when copyText is provided", () => {
      render(
        <CodeBlock copyText="fallback">
          <span>jsx content</span>
        </CodeBlock>,
      );
      expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    });
  });
});
