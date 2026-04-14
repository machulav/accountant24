import { describe, expect, mock, test } from "bun:test";
import { formatPayees } from "../payees";

let mockLoadPayees: () => Promise<string[]>;
mock.module("../../ledger/index", () => ({
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

  test("should send formatted payees when payees exist", async () => {
    mockLoadPayees = async () => ["Starbucks", "Whole Foods"];
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    payeesCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.customType).toBe("info");
    expect(msg.content[0].text).toBe(formatPayees(["Starbucks", "Whole Foods"]));
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

describe("formatPayees()", () => {
  test("should return 'No payees found.' for empty array", () => {
    expect(formatPayees([])).toBe("No payees found.");
  });

  test("should show header without count", () => {
    const result = formatPayees(["Amazon", "Starbucks"]);
    expect(result).toStartWith("# Payees");
    expect(result).not.toContain("# Payees (");
  });

  test("should format each payee as a bullet item", () => {
    const result = formatPayees(["Amazon", "Starbucks"]);
    expect(result).toContain("- Amazon");
    expect(result).toContain("- Starbucks");
  });

  test("should have empty line between header and list", () => {
    const result = formatPayees(["Amazon"]);
    expect(result).toStartWith("# Payees\n\n- Amazon");
  });

  test("should include @ tip at the end", () => {
    const result = formatPayees(["Amazon"]);
    expect(result).toEndWith(
      "> **Tip:** Type `@` in the input field to quickly search and mention accounts, payees, and tags.",
    );
  });

  test("should not include tip for empty payees", () => {
    expect(formatPayees([])).not.toContain("Tip");
  });
});
