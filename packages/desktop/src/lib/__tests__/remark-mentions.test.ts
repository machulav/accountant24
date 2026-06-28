import { describe, expect, it } from "vitest";
import { remarkMentions } from "../remark-mentions";

// Minimal mdast shapes for the transform (it only touches `type`/`value`/`children`).
type Node = {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hName?: string; hProperties?: Record<string, string> };
};

const text = (value: string): Node => ({ type: "text", value });
const para = (...children: Node[]): Node => ({ type: "paragraph", children });
const root = (...children: Node[]): Node => ({ type: "root", children });

/** Run the plugin on a tree (mutates in place) and return it. */
function run(tree: Node): Node {
  remarkMentions()(tree);
  return tree;
}

describe("remarkMentions", () => {
  it("splits a text node into text + mention nodes", () => {
    const tree = run(root(para(text("balance of :account[assets:bank:n26] today"))));
    const children = tree.children![0]!.children!;
    expect(children).toHaveLength(3);
    expect(children[0]).toEqual({ type: "text", value: "balance of " });
    expect(children[1]).toEqual({
      type: "mention",
      data: { hName: "span", hProperties: { "data-mention-type": "account", "data-mention-label": "assets:bank:n26" } },
      children: [{ type: "text", value: "assets:bank:n26" }],
    });
    expect(children[2]).toEqual({ type: "text", value: " today" });
  });

  it("renders the mention as a <span> carrying type + label data attributes", () => {
    const tree = run(root(para(text(":payee[Rewe]"))));
    const mention = tree.children![0]!.children![0]!;
    expect(mention.data?.hName).toBe("span");
    expect(mention.data?.hProperties).toEqual({ "data-mention-type": "payee", "data-mention-label": "Rewe" });
    expect(mention.children).toEqual([{ type: "text", value: "Rewe" }]);
  });

  it("leaves text nodes without directives untouched (same node identity)", () => {
    const plain = text("nothing to see here");
    const tree = root(para(plain));
    run(tree);
    expect(tree.children![0]!.children![0]).toBe(plain);
  });

  it("does not transform prose that merely contains colons", () => {
    const tree = run(root(para(text("key:value at 10:30"))));
    expect(tree.children![0]!.children).toEqual([{ type: "text", value: "key:value at 10:30" }]);
  });

  it("ignores unknown directive types", () => {
    const tree = run(root(para(text("see :foo[bar]"))));
    expect(tree.children![0]!.children).toEqual([{ type: "text", value: "see :foo[bar]" }]);
  });

  it("leaves inline code untouched (directive stays literal)", () => {
    const code: Node = { type: "inlineCode", value: ":payee[Rewe]" };
    const tree = run(root(para(code)));
    expect(tree.children![0]!.children![0]).toEqual({ type: "inlineCode", value: ":payee[Rewe]" });
  });

  it("leaves fenced code blocks untouched", () => {
    const block: Node = { type: "code", value: ":account[Assets:Bank]" };
    const tree = run(root(block));
    expect(tree.children![0]).toEqual({ type: "code", value: ":account[Assets:Bank]" });
  });

  it("recurses into nested children (e.g. list items, emphasis)", () => {
    const tree = run(
      root({
        type: "list",
        children: [{ type: "listItem", children: [para(text("spent at :payee[Rewe]"))] }],
      }),
    );
    const itemPara = tree.children![0]!.children![0]!.children![0]!;
    const mention = itemPara.children![1]!;
    expect(mention.type).toBe("mention");
    expect(mention.data?.hProperties).toEqual({ "data-mention-type": "payee", "data-mention-label": "Rewe" });
  });

  it("handles multiple mentions in one text node", () => {
    const tree = run(root(para(text(":tag[a] and :tag[b]"))));
    const kinds = tree.children![0]!.children!.map((n) => n.type);
    expect(kinds).toEqual(["mention", "text", "mention"]);
  });
});
