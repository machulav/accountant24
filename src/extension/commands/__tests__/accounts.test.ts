import { describe, expect, mock, test } from "bun:test";

let mockLoadAccounts: () => Promise<string[]>;
mock.module("../../context", () => ({
  loadAccounts: async () => mockLoadAccounts(),
}));

const { accountsCommand } = await import("../accounts.js");

describe("accountsCommand()", () => {
  test("should register command named 'accounts' with correct description", () => {
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    accountsCommand(pi);
    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    const [name, opts] = pi.registerCommand.mock.calls[0];
    expect(name).toBe("accounts");
    expect(opts.description).toBe("List all accounts");
  });

  test("should send joined accounts when accounts exist", async () => {
    mockLoadAccounts = async () => ["Assets:Checking", "Expenses:Food"];
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    accountsCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.customType).toBe("info");
    expect(msg.content[0].text).toBe("Assets:Checking\nExpenses:Food");
    expect(msg.display).toBe(true);
  });

  test("should send 'No accounts found.' when no accounts", async () => {
    mockLoadAccounts = async () => [];
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    accountsCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.content[0].text).toBe("No accounts found.");
  });
});
