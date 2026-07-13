// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { encodeAttachmentRef } from "@/lib/attachmentMarker";
import { UserMessageText } from "../attachment";

afterEach(() => {
  cleanup();
});

type Props = ComponentProps<typeof UserMessageText>;
const renderText = (text: string) => render(<UserMessageText {...({ text, type: "text" } as Props)} />);

// A manual skill invocation reaches the renderer already collapsed to its
// `:skill[name]` directive (electronPiClient rewrites pi's expanded block).

describe("UserMessageText", () => {
  it("should render plain text unchanged", () => {
    renderText("just a message");
    expect(screen.getByText("just a message")).toBeTruthy();
  });

  it("should render a skill directive as an inline chip plus the user's words", () => {
    const { container } = renderText(":skill[pdf] summarize this receipt");
    const chip = container.querySelector('[data-directive-type="skill"]');
    expect(chip?.textContent).toBe("pdf");
    expect(screen.getByText(/summarize this receipt/)).toBeTruthy();
    expect(container.textContent).not.toContain(":skill[");
  });

  it("should render only the chip for an argument-less invocation", () => {
    const { container } = renderText(":skill[pdf]");
    expect(container.querySelector('[data-directive-type="skill"]')?.textContent).toBe("pdf");
  });

  it("should lift attachment markers and keep the skill chip inline", () => {
    // Markers ride on their own line (the attachment adapter appends them).
    const marker = encodeAttachmentRef({ name: "receipt.pdf", path: "files/receipt.pdf" });
    const { container } = renderText(`:skill[pdf] summarize the attached file\n${marker}`);
    expect(screen.getByText("receipt.pdf")).toBeTruthy();
    expect(container.querySelector('[data-directive-type="skill"]')?.textContent).toBe("pdf");
    expect(screen.getByText(/summarize the attached file/)).toBeTruthy();
  });

  it("should render mention and skill chips side by side", () => {
    const { container } = renderText(":skill[pdf] file this under :account[Expenses:Food]");
    expect(container.querySelector('[data-directive-type="skill"]')?.textContent).toBe("pdf");
    expect(container.querySelector('[data-directive-type="account"]')?.textContent).toBe("Expenses:Food");
  });
});
