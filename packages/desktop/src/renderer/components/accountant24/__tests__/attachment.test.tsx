// @vitest-environment jsdom

import {
  type AssistantRuntime,
  AssistantRuntimeProvider,
  type ExternalStoreAdapter,
  type ImageMessagePartComponent,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  type TextMessagePartComponent,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { encodeAttachmentRef } from "@/lib/attachmentMarker";
import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageFileCards,
  UserMessageImage,
  UserMessageText,
} from "../attachment";

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

function Chrome({ children, image = true }: { children: ReactNode; image?: boolean }) {
  const store: ExternalStoreAdapter = {
    messages: [],
    onNew: async () => {},
    // Image adapter renders thumbnails; the text adapter produces a "document"
    // attachment so the file-chip (non-image) branch is exercised.
    adapters: { attachments: image ? new SimpleImageAttachmentAdapter() : new SimpleTextAttachmentAdapter() },
  };
  runtime = useExternalStoreRuntime(store);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

const addImage = async (name: string) => {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
  await act(() => runtime.thread.composer.addAttachment(file));
};

const addTextFile = async (name: string) => {
  const file = new File(["hello"], name, { type: "text/plain" });
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

  it("should show a card with the file name after attaching", async () => {
    render(
      <Chrome>
        <ComposerAttachments />
      </Chrome>,
    );
    await addImage("receipt.png");
    await screen.findByText("receipt.png");
    expect(document.querySelectorAll('[data-slot="attachment"]')).toHaveLength(1);
  });

  it("should describe an attached image with its type and size", async () => {
    render(
      <Chrome>
        <ComposerAttachments />
      </Chrome>,
    );
    // addImage writes 3 bytes ([1, 2, 3]).
    await addImage("receipt.png");
    expect(await screen.findByText("PNG · 3 B")).toBeInTheDocument();
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

  it("should render a non-image attachment as a file card (no thumbnail)", async () => {
    render(
      <Chrome image={false}>
        <ComposerAttachments />
      </Chrome>,
    );
    await addTextFile("statement.csv");
    await screen.findByText("statement.csv");
    // A document attachment shows the file card, not an <img> preview.
    expect(document.querySelector('[data-slot="attachment"] img')).toBeNull();
  });

  it("should describe a non-image attachment with its type and size", async () => {
    render(
      <Chrome image={false}>
        <ComposerAttachments />
      </Chrome>,
    );
    // addTextFile writes "hello" (5 bytes).
    await addTextFile("statement.csv");
    expect(await screen.findByText("CSV · 5 B")).toBeInTheDocument();
  });

  it("should remove a non-image chip when its remove button is clicked", async () => {
    render(
      <Chrome image={false}>
        <ComposerAttachments />
      </Chrome>,
    );
    await addTextFile("statement.csv");
    await screen.findByText("statement.csv");
    fireEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
    await waitFor(() => expect(screen.queryByText("statement.csv")).toBeNull());
  });
});

describe("ComposerAddAttachment", () => {
  it("should offer an attach button when an attachment adapter is configured", () => {
    render(
      <Chrome>
        <ComposerAddAttachment />
      </Chrome>,
    );
    expect(screen.getByRole("button", { name: "Attach files" })).toBeInTheDocument();
  });
});

describe("UserMessageImage", () => {
  const Img = UserMessageImage as ImageMessagePartComponent;

  it("should render the sent image with its filename as alt text", () => {
    render(<Img {...({ image: "blob:pic", filename: "receipt.png" } as ComponentProps<typeof Img>)} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "blob:pic");
    expect(img).toHaveAttribute("alt", "receipt.png");
  });

  it("should fall back to a generic alt when no filename is given", () => {
    render(<Img {...({ image: "blob:pic" } as ComponentProps<typeof Img>)} />);
    expect(screen.getByRole("img")).toHaveAttribute("alt", "attachment");
  });
});

describe("UserMessageFileCards", () => {
  const Cards = UserMessageFileCards as TextMessagePartComponent;
  const render_ = (text: string) => render(<Cards {...({ text } as ComponentProps<typeof Cards>)} />);

  it("should render a file card with the name and type for a marker", () => {
    const marker = encodeAttachmentRef({ name: "statement.pdf", path: "/ws/statement.pdf" });
    render_(`Here is my file\n${marker}`);
    expect(screen.getByText("statement.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    // Only the cards — the text belongs to UserMessageText.
    expect(screen.queryByText("Here is my file")).toBeNull();
  });

  it("should render one card per marker", () => {
    const a = encodeAttachmentRef({ name: "a.pdf", path: "/ws/a.pdf" });
    const b = encodeAttachmentRef({ name: "b.csv", path: "/ws/b.csv" });
    render_(`${a}\n${b}`);
    expect(document.querySelectorAll('[data-slot="attachment"]')).toHaveLength(2);
  });

  it("should show the file size when the marker carries one", () => {
    const marker = encodeAttachmentRef({ name: "statement.pdf", path: "/ws/statement.pdf", size: 245_000 });
    render_(marker);
    expect(screen.getByText("PDF · 245 KB")).toBeInTheDocument();
  });

  it("should render a card without a type line when the name has no extension", () => {
    const marker = encodeAttachmentRef({ name: "receipt", path: "/ws/receipt" });
    render_(marker);
    expect(screen.getByText("receipt")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="attachment-description"]')).toBeNull();
  });

  it("should render nothing when the text has no markers", () => {
    render_("just a note");
    expect(document.querySelector('[data-slot="attachment"]')).toBeNull();
    expect(screen.queryByText("just a note")).toBeNull();
  });
});

describe("UserMessageText", () => {
  const Text = UserMessageText as TextMessagePartComponent;
  const render_ = (text: string) => render(<Text {...({ text } as ComponentProps<typeof Text>)} />);

  it("should strip a file marker and show only the human text", () => {
    const marker = encodeAttachmentRef({ name: "statement.pdf", path: "/ws/statement.pdf" });
    render_(`Here is my file\n${marker}`);
    expect(screen.getByText("Here is my file")).toBeInTheDocument();
    // The marker renders neither as raw text nor as a chip — the attachment
    // row above the bubble owns the cards.
    expect(screen.queryByText(marker)).toBeNull();
    expect(screen.queryByText("statement.pdf")).toBeNull();
    expect(document.querySelector('[data-slot="attachment"]')).toBeNull();
  });

  it("should render nothing when the message is a bare attachment", () => {
    const marker = encodeAttachmentRef({ name: "photo.png", path: "/ws/photo.png" });
    const { container } = render_(marker);
    expect(container).toBeEmptyDOMElement();
  });

  it("should render plain text with no chips when there are no attachments", () => {
    render_("just a note");
    expect(screen.getByText("just a note")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="attachment"]')).toBeNull();
  });
});
