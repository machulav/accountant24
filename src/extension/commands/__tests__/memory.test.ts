import { describe, expect, mock, test } from "bun:test";

let mockGetMemory: () => Promise<string>;
mock.module("../../data/index", () => ({
  getMemory: async () => mockGetMemory(),
}));

const { formatMemory, memoryCommand } = await import("../memory.js");

describe("memoryCommand()", () => {
  test("should register command named 'memory' with correct description", () => {
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    memoryCommand(pi);
    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    const [name, opts] = pi.registerCommand.mock.calls[0];
    expect(name).toBe("memory");
    expect(opts.description).toBe("Show memory");
  });

  test("should send formatted memory when memory exists", async () => {
    mockGetMemory = async () => "## Personal\n- Name: Volo";
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    memoryCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.customType).toBe("info");
    expect(msg.content[0].text).toBe("# Memory\n\n## Personal\n- Name: Volo");
    expect(msg.display).toBe(true);
  });

  test("should send 'No memory found.' when memory is empty", async () => {
    mockGetMemory = async () => "";
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    memoryCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.content[0].text).toBe("No memory found.");
  });
});

describe("formatMemory()", () => {
  test("should return 'No memory found.' for empty string", () => {
    expect(formatMemory("")).toBe("No memory found.");
  });

  test("should show '# Memory' header with content", () => {
    const result = formatMemory("some content");
    expect(result).toStartWith("# Memory\n\n");
    expect(result).toContain("some content");
  });

  test("should preserve original content formatting", () => {
    const content = "## Section\n- item 1\n- item 2";
    const result = formatMemory(content);
    expect(result).toBe("# Memory\n\n## Section\n- item 1\n- item 2");
  });
});
