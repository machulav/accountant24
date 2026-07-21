import { describe, expect, it } from "vitest";
import { type AttachmentRef, encodeAttachmentRef, extractAttachmentRefs } from "../attachmentMarker";

const REF: AttachmentRef = { name: "statement.pdf", path: "files/2026/04/statement.pdf" };

describe("encodeAttachmentRef()", () => {
  it("should encode a ref as a single marker line with no internal newlines", () => {
    const line = encodeAttachmentRef(REF);
    expect(line.startsWith("[[attachment]]")).toBe(true);
    expect(line).not.toContain("\n");
    expect(line).toBe(`[[attachment]]${JSON.stringify(REF)}`);
  });
});

describe("extractAttachmentRefs()", () => {
  it("should round-trip an encoded ref and leave no visible text", () => {
    const { text, refs } = extractAttachmentRefs(encodeAttachmentRef(REF));
    expect(refs).toEqual([REF]);
    expect(text).toBe("");
  });

  it("should split visible prose from the marker lines", () => {
    const input = `Please log this\n${encodeAttachmentRef(REF)}`;
    const { text, refs } = extractAttachmentRefs(input);
    expect(text).toBe("Please log this");
    expect(refs).toEqual([REF]);
  });

  it("should preserve multiple refs in order among prose", () => {
    const a: AttachmentRef = { name: "a.pdf", path: "files/a.pdf" };
    const b: AttachmentRef = { name: "b.png", path: "files/b.png" };
    const input = `${encodeAttachmentRef(a)}\nhello\n${encodeAttachmentRef(b)}`;
    const { text, refs } = extractAttachmentRefs(input);
    expect(text).toBe("hello");
    expect(refs).toEqual([a, b]);
  });

  it("should drop a marker line whose payload is not valid JSON", () => {
    const { text, refs } = extractAttachmentRefs("[[attachment]]{not json");
    expect(refs).toEqual([]);
    expect(text).toBe("");
  });

  it("should drop a marker missing the name or path field", () => {
    const missingPath = `[[attachment]]${JSON.stringify({ name: "x" })}`;
    const missingName = `[[attachment]]${JSON.stringify({ path: "files/x" })}`;
    expect(extractAttachmentRefs(missingPath).refs).toEqual([]);
    expect(extractAttachmentRefs(missingName).refs).toEqual([]);
  });

  it("should trim surrounding whitespace from the remaining text", () => {
    const input = `\n\n${encodeAttachmentRef(REF)}\n\n`;
    expect(extractAttachmentRefs(input).text).toBe("");
  });

  it("should return the input unchanged when there are no markers", () => {
    const { text, refs } = extractAttachmentRefs("just a normal message");
    expect(text).toBe("just a normal message");
    expect(refs).toEqual([]);
  });
});
