import { describe, expect, mock, test } from "bun:test";
import { formatTags } from "../tags";

let mockLoadTags: () => Promise<string[]>;
mock.module("../../data/index", () => ({
  listTags: async () => mockLoadTags(),
}));

const { tagsCommand } = await import("../tags.js");

describe("tagsCommand()", () => {
  test("should register command named 'tags' with correct description", () => {
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    tagsCommand(pi);
    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    const [name, opts] = pi.registerCommand.mock.calls[0];
    expect(name).toBe("tags");
    expect(opts.description).toBe("List all tags");
  });

  test("should send formatted tags when tags exist", async () => {
    mockLoadTags = async () => ["groceries", "weekly"];
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    tagsCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.customType).toBe("info");
    expect(msg.content[0].text).toBe(formatTags(["groceries", "weekly"]));
    expect(msg.display).toBe(true);
  });

  test("should send 'No tags found.' when no tags", async () => {
    mockLoadTags = async () => [];
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    tagsCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.content[0].text).toBe("No tags found.");
  });
});

describe("formatTags()", () => {
  test("should return 'No tags found.' for empty array", () => {
    expect(formatTags([])).toBe("No tags found.");
  });

  test("should show header without count", () => {
    const result = formatTags(["groceries", "weekly"]);
    expect(result).toStartWith("# Tags");
    expect(result).not.toContain("# Tags (");
  });

  test("should format each tag as a bullet item", () => {
    const result = formatTags(["groceries", "weekly"]);
    expect(result).toContain("- groceries");
    expect(result).toContain("- weekly");
  });

  test("should have empty line between header and list", () => {
    const result = formatTags(["groceries"]);
    expect(result).toStartWith("# Tags\n\n- groceries");
  });

  test("should include @ tip at the end", () => {
    const result = formatTags(["groceries"]);
    expect(result).toEndWith(
      "> **Tip:** Type `@` in the input field to quickly search and mention accounts, payees, and tags.",
    );
  });

  test("should not include tip for empty tags", () => {
    expect(formatTags([])).not.toContain("Tip");
  });
});
