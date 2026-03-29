import { describe, expect, mock, test } from "bun:test";

let mockLoadTags: () => Promise<string[]>;
mock.module("../../context", () => ({
  loadTags: async () => mockLoadTags(),
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

  test("should send joined tags when tags exist", async () => {
    mockLoadTags = async () => ["groceries", "weekly"];
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    tagsCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.customType).toBe("info");
    expect(msg.content[0].text).toBe("groceries\nweekly");
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
