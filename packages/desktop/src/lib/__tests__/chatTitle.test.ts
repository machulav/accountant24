import { describe, expect, it } from "vitest";
import { encodeAttachmentRef } from "../attachmentMarker";
import { deriveChatTitle } from "../chatTitle";

const file = (name: string, path = `files/2026/06/${name}`) => encodeAttachmentRef({ name, path });

describe("deriveChatTitle", () => {
  describe("text messages", () => {
    it("titles from plain text", () => {
      expect(deriveChatTitle({ texts: ["add 5 EUR coffee"], imageNames: [] })).toBe("add 5 EUR coffee");
    });

    it("collapses whitespace and trims", () => {
      expect(deriveChatTitle({ texts: ["  add   5\nEUR  "], imageNames: [] })).toBe("add 5 EUR");
    });

    it("joins multiple text parts with a space", () => {
      expect(deriveChatTitle({ texts: ["hello", "world"], imageNames: [] })).toBe("hello world");
    });
  });

  describe("mentions", () => {
    it("renders a mention directive as its plain label", () => {
      expect(deriveChatTitle({ texts: ["balance of :account[assets:bank:n26]"], imageNames: [] })).toBe(
        "balance of assets:bank:n26",
      );
    });

    it("titles from a mention-only message", () => {
      expect(deriveChatTitle({ texts: [":payee[Telekom Deutschland]"], imageNames: [] })).toBe("Telekom Deutschland");
    });

    it("strips multiple mentions", () => {
      expect(deriveChatTitle({ texts: ["from :payee[Rewe] to :tag[trip]"], imageNames: [] })).toBe("from Rewe to trip");
    });
  });

  describe("file attachment only", () => {
    it("titles from the file name", () => {
      expect(deriveChatTitle({ texts: [file("statement.pdf")], imageNames: [] })).toBe("statement.pdf");
    });

    it("joins multiple file names", () => {
      expect(deriveChatTitle({ texts: [file("a.pdf"), file("b.csv")], imageNames: [] })).toBe("a.pdf, b.csv");
    });

    it("drops a malformed marker and yields no title", () => {
      expect(deriveChatTitle({ texts: ["[[attachment]]{not json"], imageNames: [] })).toBeNull();
    });
  });

  describe("image attachment only", () => {
    it("titles from the image name", () => {
      expect(deriveChatTitle({ texts: [], imageNames: ["receipt.png"] })).toBe("receipt.png");
    });

    it("joins multiple image names", () => {
      expect(deriveChatTitle({ texts: [""], imageNames: ["a.png", "b.jpg"] })).toBe("a.png, b.jpg");
    });
  });

  describe("combinations", () => {
    it("prefers text over an attached file", () => {
      expect(deriveChatTitle({ texts: [`here is my receipt\n${file("receipt.pdf")}`], imageNames: [] })).toBe(
        "here is my receipt",
      );
    });

    it("prefers text over an attached image", () => {
      expect(deriveChatTitle({ texts: ["analyze this"], imageNames: ["photo.png"] })).toBe("analyze this");
    });

    it("prefers a mention label over attachments", () => {
      expect(deriveChatTitle({ texts: [`:payee[Rewe]\n${file("r.pdf")}`], imageNames: ["r.png"] })).toBe("Rewe");
    });

    it("falls back to files then images when there is no text (files first)", () => {
      expect(deriveChatTitle({ texts: [file("doc.pdf")], imageNames: ["pic.png"] })).toBe("doc.pdf, pic.png");
    });

    it("uses images when an attachment-only message has whitespace text", () => {
      expect(deriveChatTitle({ texts: ["   "], imageNames: ["pic.png"] })).toBe("pic.png");
    });
  });

  describe("empty", () => {
    it("returns null with no inputs", () => {
      expect(deriveChatTitle({ texts: [], imageNames: [] })).toBeNull();
    });

    it("returns null for whitespace-only text and nothing else", () => {
      expect(deriveChatTitle({ texts: ["  \n  "], imageNames: [] })).toBeNull();
    });
  });

  describe("truncation (max 60 chars)", () => {
    it("leaves a title of exactly 60 chars untouched", () => {
      const sixty = "a".repeat(60);
      expect(deriveChatTitle({ texts: [sixty], imageNames: [] })).toBe(sixty);
    });

    it("truncates a longer title and appends an ellipsis", () => {
      const result = deriveChatTitle({ texts: ["a".repeat(70)], imageNames: [] });
      expect(result).toBe(`${"a".repeat(60)}…`);
      expect(result).toHaveLength(61); // 60 chars + the ellipsis
    });

    it("trims trailing whitespace before the ellipsis", () => {
      // char 60 lands on a space — it should be trimmed, not left dangling.
      const text = `${"a".repeat(59)} bbbbb`;
      expect(deriveChatTitle({ texts: [text], imageNames: [] })).toBe(`${"a".repeat(59)}…`);
    });
  });
});
