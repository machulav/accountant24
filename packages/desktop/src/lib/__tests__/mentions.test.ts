import { describe, expect, it } from "vitest";
import { hasMention, mentionsToPlainText, parseMentions } from "../mentions";

describe("parseMentions", () => {
  it("returns a single text segment for empty input", () => {
    expect(parseMentions("")).toEqual([{ kind: "text", value: "" }]);
  });

  it("returns a single text segment when there are no directives", () => {
    expect(parseMentions("just some words")).toEqual([{ kind: "text", value: "just some words" }]);
  });

  it("parses a lone account mention", () => {
    expect(parseMentions(":account[Assets:Bank]")).toEqual([
      { kind: "mention", type: "account", label: "Assets:Bank" },
    ]);
  });

  it("keeps colons inside an account label", () => {
    expect(parseMentions(":account[assets:bank:n26]")).toEqual([
      { kind: "mention", type: "account", label: "assets:bank:n26" },
    ]);
  });

  it("parses payee and tag types", () => {
    expect(parseMentions(":payee[Rewe]")).toEqual([{ kind: "mention", type: "payee", label: "Rewe" }]);
    expect(parseMentions(":tag[trip]")).toEqual([{ kind: "mention", type: "tag", label: "trip" }]);
  });

  it("keeps spaces inside a label", () => {
    expect(parseMentions(":payee[Telekom Deutschland]")).toEqual([
      { kind: "mention", type: "payee", label: "Telekom Deutschland" },
    ]);
  });

  it("splits text before and after a mention", () => {
    expect(parseMentions("balance of :account[Cash] today")).toEqual([
      { kind: "text", value: "balance of " },
      { kind: "mention", type: "account", label: "Cash" },
      { kind: "text", value: " today" },
    ]);
  });

  it("handles a mention at the start (no leading empty text)", () => {
    expect(parseMentions(":tag[trip] starts here")).toEqual([
      { kind: "mention", type: "tag", label: "trip" },
      { kind: "text", value: " starts here" },
    ]);
  });

  it("handles a mention at the end (no trailing empty text)", () => {
    expect(parseMentions("ends with :payee[Rewe]")).toEqual([
      { kind: "text", value: "ends with " },
      { kind: "mention", type: "payee", label: "Rewe" },
    ]);
  });

  it("handles adjacent mentions without an empty text segment between", () => {
    expect(parseMentions(":tag[a]:tag[b]")).toEqual([
      { kind: "mention", type: "tag", label: "a" },
      { kind: "mention", type: "tag", label: "b" },
    ]);
  });

  it("parses multiple mentions separated by text", () => {
    expect(parseMentions("from :payee[Rewe] to :account[Expenses:Food]")).toEqual([
      { kind: "text", value: "from " },
      { kind: "mention", type: "payee", label: "Rewe" },
      { kind: "text", value: " to " },
      { kind: "mention", type: "account", label: "Expenses:Food" },
    ]);
  });

  it("accepts and discards a {name=id} suffix, keeping the bracket label", () => {
    expect(parseMentions(":account[Assets:Bank]{name=assets:bank}")).toEqual([
      { kind: "mention", type: "account", label: "Assets:Bank" },
    ]);
  });

  it.each([
    ["a key:value pair"],
    ["meet at 10:30 today"],
    ["see http://example.com"],
    ["note: this is fine"],
    ["ratio 3:2"],
  ])("does not treat ordinary prose colons as mentions: %s", (input) => {
    expect(parseMentions(input)).toEqual([{ kind: "text", value: input }]);
  });

  it("ignores unknown directive types", () => {
    expect(parseMentions("see :foo[bar] here")).toEqual([{ kind: "text", value: "see :foo[bar] here" }]);
  });

  it("ignores an empty bracket (no label)", () => {
    expect(parseMentions(":account[] empty")).toEqual([{ kind: "text", value: ":account[] empty" }]);
  });

  it("is deterministic across repeated calls (no shared regex state)", () => {
    const input = "x :tag[t] y";
    expect(parseMentions(input)).toEqual(parseMentions(input));
  });
});

describe("mentionsToPlainText", () => {
  it("replaces a directive with its label", () => {
    expect(mentionsToPlainText("balance :account[assets:bank:n26] now")).toBe("balance assets:bank:n26 now");
  });

  it("replaces a label with spaces", () => {
    expect(mentionsToPlainText("paid :payee[Telekom Deutschland]")).toBe("paid Telekom Deutschland");
  });

  it("strips the {name=id} suffix, keeping the label", () => {
    expect(mentionsToPlainText(":account[X]{name=x}")).toBe("X");
  });

  it("replaces every directive in the string", () => {
    expect(mentionsToPlainText(":payee[Rewe] / :tag[trip]")).toBe("Rewe / trip");
  });

  it("leaves non-directive text untouched", () => {
    expect(mentionsToPlainText("key:value at 10:30")).toBe("key:value at 10:30");
    expect(mentionsToPlainText("see :foo[bar]")).toBe("see :foo[bar]");
  });

  it("returns empty string unchanged", () => {
    expect(mentionsToPlainText("")).toBe("");
  });
});

describe("hasMention", () => {
  it("is true when a directive is present", () => {
    expect(hasMention("a :tag[trip] b")).toBe(true);
  });

  it("is false for plain text and prose colons", () => {
    expect(hasMention("no mentions here")).toBe(false);
    expect(hasMention("key:value")).toBe(false);
    expect(hasMention(":foo[bar]")).toBe(false);
  });

  it("is stable across repeated calls (no lastIndex leakage)", () => {
    expect(hasMention(":tag[trip]")).toBe(true);
    expect(hasMention(":tag[trip]")).toBe(true);
  });
});
