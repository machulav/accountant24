import { describe, expect, it } from "vitest";
import { collapseSkillText, hoistSkillDirective, parseSkillBlock } from "../skillBlock";

// Format spec: pi rewrites `/skill:<name> <args>` into
//   <skill name="<name>" location="<abs SKILL.md path>">\n
//   <body>\n
//   </skill>
// followed by `\n\n<args>` when arguments were given.

const BLOCK =
  '<skill name="pdf" location="/ws/skills/pdf/SKILL.md">\n' +
  "References are relative to /ws/skills/pdf.\n\n# PDF\nUse pypdf.\n" +
  "</skill>";

describe("parseSkillBlock()", () => {
  it("should parse a block without arguments", () => {
    expect(parseSkillBlock(BLOCK)).toEqual({
      name: "pdf",
      location: "/ws/skills/pdf/SKILL.md",
      content: "References are relative to /ws/skills/pdf.\n\n# PDF\nUse pypdf.",
    });
  });

  it("should parse a block with the user's trailing message", () => {
    const parsed = parseSkillBlock(`${BLOCK}\n\nsummarize this receipt`);
    expect(parsed?.name).toBe("pdf");
    expect(parsed?.userMessage).toBe("summarize this receipt");
  });

  it("should keep multiline user messages intact", () => {
    const parsed = parseSkillBlock(`${BLOCK}\n\nline one\nline two`);
    expect(parsed?.userMessage).toBe("line one\nline two");
  });

  it("should return null for plain text", () => {
    expect(parseSkillBlock("summarize this receipt")).toBeNull();
  });

  it("should return null when the block is not at the start of the message", () => {
    expect(parseSkillBlock(`hello\n${BLOCK}`)).toBeNull();
  });

  it("should return null for an unterminated block", () => {
    expect(parseSkillBlock('<skill name="pdf" location="/x">\nbody')).toBeNull();
  });

  it("should omit userMessage when the trailing text is only whitespace", () => {
    // pi trims args before appending, but a hand-crafted message could carry
    // whitespace — the chip renderer must not show an empty remainder.
    const parsed = parseSkillBlock(`${BLOCK}\n\n   `);
    // The regex requires at least one char after \n\n; whitespace-only matches
    // but trims to empty → treated as absent.
    expect(parsed).not.toBeNull();
    expect(parsed?.userMessage).toBeUndefined();
  });
});

describe("hoistSkillDirective()", () => {
  it("should pass a message without a skill chip through untouched", () => {
    expect(hoistSkillDirective("add 12 EUR for coffee")).toBe("add 12 EUR for coffee");
  });

  it("should turn a leading chip into pi's /skill: token", () => {
    expect(hoistSkillDirective(":skill[pdf] summarize this receipt")).toBe("/skill:pdf summarize this receipt");
  });

  it("should hoist a chip from the middle of the message to the front", () => {
    expect(hoistSkillDirective("use :skill[web-search] for current prices")).toBe(
      "/skill:web-search use for current prices",
    );
  });

  it("should send just the token for a chip with no other text", () => {
    expect(hoistSkillDirective(":skill[pdf]")).toBe("/skill:pdf");
    expect(hoistSkillDirective("  :skill[pdf]  ")).toBe("/skill:pdf");
  });

  it("should keep attachment markers in the trailing text after the token", () => {
    const marker = '[[attachment]]{"name":"r.pdf","path":"files/r.pdf"}';
    expect(hoistSkillDirective(`:skill[pdf] ${marker}\nsummarize`)).toBe(`/skill:pdf ${marker}\nsummarize`);
  });

  it("should hoist only the first chip and leave any others as text", () => {
    expect(hoistSkillDirective(":skill[pdf] and :skill[xlsx] too")).toBe("/skill:pdf and :skill[xlsx] too");
  });

  it("should not touch mention directives", () => {
    expect(hoistSkillDirective("pay :payee[Acme] 12 EUR")).toBe("pay :payee[Acme] 12 EUR");
  });

  it("should ignore malformed skill directives", () => {
    expect(hoistSkillDirective(":skill[Not Valid!] hi")).toBe(":skill[Not Valid!] hi");
    expect(hoistSkillDirective(":skill[] hi")).toBe(":skill[] hi");
  });
});

describe("collapseSkillText()", () => {
  it("should collapse pi's expanded block back to the directive with the user's words", () => {
    expect(collapseSkillText(`${BLOCK}\n\nsummarize this receipt`)).toBe(":skill[pdf] summarize this receipt");
  });

  it("should collapse an argument-less block to the bare directive", () => {
    expect(collapseSkillText(BLOCK)).toBe(":skill[pdf]");
  });

  it("should round-trip exactly with the send-time hoist (the dedupe contract)", () => {
    // The runtime reconciles the optimistic copy of a sent message against the
    // transcript by exact text — what the composer sends must come back
    // char-identical after hoist → pi expansion → collapse.
    const composerText = ":skill[pdf] summarize this receipt";
    const wire = hoistSkillDirective(composerText); // "/skill:pdf summarize this receipt"
    // pi's expansion of that wire text (agent-session.js _expandSkillCommand):
    const expanded =
      '<skill name="pdf" location="/ws/skills/pdf/SKILL.md">\n' +
      "References are relative to /ws/skills/pdf.\n\nbody\n" +
      "</skill>\n\nsummarize this receipt";
    expect(wire).toBe("/skill:pdf summarize this receipt");
    expect(collapseSkillText(expanded)).toBe(composerText);
  });

  it("should collapse an unexpanded /skill: prefix (unknown skill passed through by pi)", () => {
    expect(collapseSkillText("/skill:ghost do things")).toBe(":skill[ghost] do things");
    expect(collapseSkillText("/skill:ghost")).toBe(":skill[ghost]");
  });

  it("should pass plain text through untouched", () => {
    expect(collapseSkillText("just a message")).toBe("just a message");
    expect(collapseSkillText("prices are 10/skill:none")).toBe("prices are 10/skill:none");
  });
});
