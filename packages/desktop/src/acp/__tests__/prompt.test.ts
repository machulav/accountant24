import type { ContentBlock } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { toPiPrompt } from "../prompt";

describe("toPiPrompt()", () => {
  it("should return an empty prompt for no blocks", () => {
    expect(toPiPrompt([])).toEqual({ message: "", images: [] });
  });

  it("should pass a single text block through unchanged", () => {
    expect(toPiPrompt([{ type: "text", text: "How much did I spend?" }])).toEqual({
      message: "How much did I spend?",
      images: [],
    });
  });

  it("should join multiple text blocks with a blank line", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ];
    expect(toPiPrompt(blocks).message).toBe("first\n\nsecond");
  });

  it("should skip an empty text block rather than emit a blank paragraph", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "only" },
      { type: "text", text: "" },
    ];
    expect(toPiPrompt(blocks).message).toBe("only");
  });

  it("should collect image blocks separately from the message", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "what is this?" },
      { type: "image", data: "aGk=", mimeType: "image/png" },
    ];
    expect(toPiPrompt(blocks)).toEqual({
      message: "what is this?",
      images: [{ type: "image", mimeType: "image/png", data: "aGk=" }],
    });
  });

  it("should keep multiple images in order", () => {
    const blocks: ContentBlock[] = [
      { type: "image", data: "one", mimeType: "image/png" },
      { type: "image", data: "two", mimeType: "image/jpeg" },
    ];
    expect(toPiPrompt(blocks).images.map((i) => i.data)).toEqual(["one", "two"]);
  });

  it("should render a resource_link as its URI", () => {
    const blocks: ContentBlock[] = [{ type: "resource_link", uri: "file:///ws/ledger/main.journal", name: "main" }];
    expect(toPiPrompt(blocks).message).toBe("[Context] file:///ws/ledger/main.journal");
  });

  it("should inline a text resource as a fenced block tagged with its URI", () => {
    const blocks: ContentBlock[] = [
      { type: "resource", resource: { uri: "file:///ws/notes.md", text: "hello", mimeType: "text/markdown" } },
    ];
    expect(toPiPrompt(blocks).message).toBe("[Context] file:///ws/notes.md\n```\nhello\n```");
  });

  it("should announce a binary resource by URI only, since pi cannot read the blob", () => {
    const blocks: ContentBlock[] = [
      { type: "resource", resource: { uri: "file:///ws/scan.pdf", blob: "JVBER", mimeType: "application/pdf" } },
    ];
    expect(toPiPrompt(blocks).message).toBe("[Context] file:///ws/scan.pdf");
  });

  it("should ignore an unknown block type instead of failing the turn", () => {
    const blocks = [
      { type: "audio", data: "x", mimeType: "audio/wav" },
      { type: "text", text: "still here" },
    ] as ContentBlock[];
    expect(toPiPrompt(blocks)).toEqual({ message: "still here", images: [] });
  });

  it("should preserve the order of mixed text and context blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "look at" },
      { type: "resource_link", uri: "file:///a", name: "a" },
      { type: "text", text: "and tell me" },
    ];
    expect(toPiPrompt(blocks).message).toBe("look at\n\n[Context] file:///a\n\nand tell me");
  });
});
