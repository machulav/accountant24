import { describe, expect, mock, test } from "bun:test";

let mockLoadPayees: () => Promise<string[]>;
mock.module("../../data/index", () => ({
  listPayees: async () => mockLoadPayees(),
}));

const { payeesCommand } = await import("../payees.js");

describe("payeesCommand()", () => {
  test("should register command named 'payees' with correct description", () => {
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    payeesCommand(pi);
    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    const [name, opts] = pi.registerCommand.mock.calls[0];
    expect(name).toBe("payees");
    expect(opts.description).toBe("List all payees");
  });

  test("should send joined payees when payees exist", async () => {
    mockLoadPayees = async () => ["Whole Foods", "Starbucks"];
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    payeesCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.customType).toBe("info");
    expect(msg.content[0].text).toBe("Whole Foods\nStarbucks");
    expect(msg.display).toBe(true);
  });

  test("should send 'No payees found.' when no payees", async () => {
    mockLoadPayees = async () => [];
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    payeesCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.content[0].text).toBe("No payees found.");
  });
});
